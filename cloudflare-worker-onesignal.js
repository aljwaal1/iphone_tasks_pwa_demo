export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "POST only" }, 405);
    }

    try {
      const body = await request.json();
      const action = body.action || "schedule";

      if (action === "cancel") {
        const notificationId = body.notificationId;
        if (!notificationId) return json({ ok: false, error: "Missing notificationId" }, 400);

        const cancelUrl = `https://api.onesignal.com/notifications/${notificationId}?app_id=${env.ONESIGNAL_APP_ID}`;
        const response = await fetch(cancelUrl, {
          method: "DELETE",
          headers: { "Authorization": `Key ${env.ONESIGNAL_REST_API_KEY}` }
        });

        let data = null;
        try { data = await response.json(); } catch (_) { data = { message: "No JSON response" }; }
        return json({ ok: response.ok, status: response.status, data }, response.status);
      }

      const subscriptionId = body.subscriptionId;
      if (!subscriptionId) return json({ ok: false, error: "Missing subscriptionId" }, 400);

      const payload = {
        app_id: env.ONESIGNAL_APP_ID,
        target_channel: "push",
        include_subscription_ids: [subscriptionId],
        headings: {
          ar: body.title || "تذكير مهمة",
          en: body.title || "Task Reminder"
        },
        contents: {
          ar: body.message || "لديك مهمة الآن",
          en: body.message || "You have a task now"
        },
        priority: 10,
        ios_sound: "default",
        ios_interruption_level: "time-sensitive",
        ios_badgeType: "Increase",
        ios_badgeCount: 1,
        android_sound: "default",
        android_visibility: 1
      };

      if (body.sendAfter) {
        payload.send_after = body.sendAfter;
      }

      const response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${env.ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      return json({ ok: response.ok, status: response.status, id: data?.id || null, data }, response.status);

    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
