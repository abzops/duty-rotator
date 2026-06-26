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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // CORS Preflight Handler
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase Client using the service role key for administrative access
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase env configuration." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { sender_id, target_id, title, body } = await req.json();

    if (!sender_id || !target_id || !title || !body) {
      return new Response(JSON.stringify({ error: "Missing required payload fields." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. Verify that sender is an Admin in the database profiles table
    const { data: senderProfile, error: senderErr } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", sender_id)
      .single();

    if (senderErr || !senderProfile || !senderProfile.is_admin) {
      return new Response(JSON.stringify({ error: "Unauthorized. Admin credentials required to send alerts." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Fetch push subscriptions for the recipient profile
    const { data: subscriptions, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("profile_id", target_id);

    if (subErr) throw subErr;

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Recipient member has not registered push notifications on any devices." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Dispatch web push alerts
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
          title: title,
          body: body,
          url: `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host") || "duty-rotator-web-app.firebaseapp.com"}`
        });

        await webpush.sendNotification(pushSubscription, payload);
        sentCount++;
      } catch (pushErr: any) {
        // Automatically prune expired subscriptions
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          console.log(`Pruning expired subscription ID: ${sub.id}`);
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error(`Failed pushing notification to sub ${sub.id}:`, pushErr);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent_count: sentCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("send-custom-push edge function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
