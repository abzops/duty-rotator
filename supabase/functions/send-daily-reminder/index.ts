import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import webpush from "npm:web-push";

// VAPID keys fallbacks (can be set as Environment Variables in Supabase dashboard)
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "BLES5mOVYnR7CLy8frmWtgDz-cy_ejZow99ZQc8LnEcR0FIb9T60STs8f6UGv_zjslcIJWFLf0Z815JMz_XcoVY";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "rw-McxvG5OQYfTp-JqvM_pmapyddGjbeIqJ_N4Qmri4";

// Configure web-push details
webpush.setVapidDetails(
  "mailto:abzops@users.noreply.github.com",
  vapidPublicKey,
  vapidPrivateKey
);

const BASELINE_DATE = new Date("2026-01-01T00:00:00Z");

function getDutyTypeForDate(date: Date) {
  const day = date.getUTCDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  if (day === 1 || day === 3 || day === 5) {
    return 'food';
  } else if (day === 4) {
    return 'plastic';
  }
  return null;
}

function getDutyDayIndex(targetDate: Date) {
  const current = new Date(BASELINE_DATE.getTime());
  current.setUTCHours(0, 0, 0, 0);
  
  const target = new Date(targetDate.getTime());
  target.setUTCHours(0, 0, 0, 0);

  if (target < current) return 0;

  // Calculate full weeks using UTC dates
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((target.getTime() - current.getTime()) / msPerDay);
  const diffWeeks = Math.floor(diffDays / 7);

  let count = diffWeeks * 4; // 4 active duty days per week

  const startChecking = new Date(current.getTime() + diffWeeks * 7 * msPerDay);
  startChecking.setUTCHours(0, 0, 0, 0);

  while (startChecking <= target) {
    if (getDutyTypeForDate(startChecking) !== null) {
      count++;
    }
    startChecking.setUTCDate(startChecking.getUTCDate() + 1);
  }
  return count;
}


// Seeded Pseudorandom Number Generator (Mulberry32)
function seededRandom(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic shuffle using a string seed
function seededShuffle<T>(array: T[], seedString: string): T[] {
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = (seed * 31 + seedString.charCodeAt(i)) | 0;
  }
  const rand = seededRandom(seed);
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
}

Deno.serve(async (req) => {
  // 1. Authorize calling client (ensure only cron triggers it using service key)
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  
  if (serviceRoleKey && authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. Initialize Supabase Client
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase URL or Service Role key environment variables." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 3. Resolve Date in Indian Standard Time (IST - UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const dateStr = istDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const dutyType = getDutyTypeForDate(istDate);

  if (!dutyType) {
    return new Response(JSON.stringify({ message: "Today is a rest day. No notifications sent.", date: dateStr }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  console.log(`Processing ${dutyType} duty for date: ${dateStr}`);
  const notificationsSent: Array<{ workspace: string; users: string[]; count: number }> = [];

  // 4. Process each workspace
  for (const workspace of ['office', 'house']) {
    try {
      // A. Fetch workspace members
      const { data: members, error: memErr } = await supabase
        .from('profiles')
        .select('*')
        .or(`workspace_association.eq.both,workspace_association.eq.${workspace}`);

      if (memErr) throw memErr;
      if (!members || members.length === 0) {
        console.log(`No members found for workspace: ${workspace}`);
        continue;
      }

      // B. Fetch workspace pairs
      const { data: dbPairs, error: pairErr } = await supabase
        .from('pairs')
        .select('*')
        .eq('workspace', workspace);

      if (pairErr) throw pairErr;

      let finalPairs = dbPairs || [];

      // Self-healing / Sync logic for House Mode individual chores
      if (workspace === 'house') {
        const missingPairs = [];
        for (const member of members) {
          const hasSinglePair = finalPairs.some(p => p.member1_id === member.id && !p.member2_id);
          if (!hasSinglePair) {
            missingPairs.push({
              workspace: 'house',
              member1_id: member.id,
              member2_id: null
            });
          }
        }

        if (missingPairs.length > 0) {
          console.log(`[House Mode] Auto-creating ${missingPairs.length} single-member pairs...`);
          const { data: insertedPairs, error: insErr } = await supabase
            .from('pairs')
            .insert(missingPairs)
            .select();

          if (insErr) {
            console.error("Error inserting single-member pairs:", insErr);
          } else if (insertedPairs) {
            finalPairs.push(...insertedPairs);
          }
        }
        // Filter out any multi-member pairs in house mode
        finalPairs = finalPairs.filter(p => !p.member2_id);
      } else {
        // Filter out any single-member pairs in office mode
        finalPairs = finalPairs.filter(p => p.member2_id !== null);
      }

      if (finalPairs.length === 0) {
        console.log(`No pairs configured for workspace: ${workspace}`);
        continue;
      }

      // C. Fetch recent duties to resolve overrides or status
      const { data: dbDuties, error: dutyErr } = await supabase
        .from('duties')
        .select('*')
        .eq('workspace', workspace);

      if (dutyErr) throw dutyErr;

      // D. Resolve today's assigned pair
      let assignedPair = null;
      let isCompleted = false;

      const savedRecord = (dbDuties || []).find(d => d.date === dateStr && d.duty_type === dutyType);
      const activePairId = savedRecord ? (savedRecord.override_pair_id || savedRecord.pair_id) : null;

      if (savedRecord && (savedRecord.completed || activePairId)) {
        if (savedRecord.completed) {
          console.log(`Duty for ${workspace} on ${dateStr} is already completed.`);
          isCompleted = true;
        } else {
          assignedPair = finalPairs.find(p => p.id === activePairId);
        }
      } else {
        // Deterministic rotation fallback (or if blank pending record exists)
        const dutyIndex = getDutyDayIndex(istDate);
        // Sort pairs by ID to establish a deterministic baseline
        const sortedPairs = [...finalPairs].sort((a, b) => a.id.localeCompare(b.id));
        
        // Seed shuffle based on Year-Month of target date to rotate randomly every month
        const yyyy = istDate.getUTCFullYear();
        const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
        const monthSeed = `${yyyy}-${mm}`;
        const shuffledPairs = seededShuffle(sortedPairs, monthSeed);
        
        assignedPair = shuffledPairs[dutyIndex % shuffledPairs.length];
      }

      if (isCompleted || !assignedPair) {
        continue;
      }

      // E. Get assigned member profiles and names
      const member1 = members.find(m => m.id === assignedPair.member1_id);
      const name1 = member1 ? member1.name : "Unknown User";

      let name2 = "";
      if (assignedPair.member2_id) {
        const member2 = members.find(m => m.id === assignedPair.member2_id);
        name2 = member2 ? member2.name : "Unknown User";
      }

      const memberNames = name2 ? `${name1} & ${name2}` : name1;
      const targetUserIds = [assignedPair.member1_id];
      if (assignedPair.member2_id) {
        targetUserIds.push(assignedPair.member2_id);
      }

      console.log(`Resolved assigned members for ${workspace}: ${memberNames} (IDs: ${targetUserIds.join(', ')})`);

      // F. Fetch push subscriptions
      const { data: subscriptions, error: subErr } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('profile_id', targetUserIds);

      if (subErr) throw subErr;

      if (!subscriptions || subscriptions.length === 0) {
        console.log(`No active push subscriptions found for: ${memberNames}`);
        notificationsSent.push({ workspace, users: targetUserIds, count: 0 });
        continue;
      }

      // G. Send background push notifications
      let sentCount = 0;
      for (const sub of subscriptions) {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          };

          const payload = JSON.stringify({
            title: `Waste Duty Today 🗑️`,
            body: `Hey ${memberNames}, today is your turn for ${dutyType === 'food' ? 'Food Waste' : 'Plastic Waste'} duty in ${workspace === 'office' ? 'Office' : 'House'}. Please empty the bins!`,
            url: `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host") || "duty-rotator-web-app.firebaseapp.com"}`
          });

          await webpush.sendNotification(pushSubscription, payload);
          sentCount++;
        } catch (pushErr: any) {
          // If the push service returns 404 Not Found or 410 Gone, the subscription is expired/invalid. Delete it!
          if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
            console.log(`Subscription expired (Status ${pushErr.statusCode}) for profile ${sub.profile_id}. Deleting subscription from database...`);
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
          } else {
            console.error(`Failed to send push to subscription ID ${sub.id}:`, pushErr);
          }
        }
      }

      notificationsSent.push({ 
        workspace, 
        users: [memberNames], 
        count: sentCount 
      });

    } catch (err: any) {
      console.error(`Error processing workspace ${workspace}:`, err);
    }
  }

  return new Response(JSON.stringify({ 
    success: true, 
    date: dateStr, 
    dutyType,
    notifications: notificationsSent 
  }), {
    headers: { "Content-Type": "application/json" }
  });
});
