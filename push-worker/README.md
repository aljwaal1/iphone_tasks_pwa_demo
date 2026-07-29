# خادم Web Push لتطبيق مهامي

لا يستخدم أسماء مستخدمين أو كلمات مرور. كل تثبيت للتطبيق يحصل على معرف وسر عشوائيين داخل الجهاز.

## النشر

```bash
cd push-worker
npm install
npx wrangler login
npx wrangler d1 create iphone-tasks-push
```

انسخ `database_id` إلى `wrangler.toml`، ثم أنشئ مفاتيح VAPID:

```bash
npm run vapid
```

ضع المفتاح العام في `VAPID_PUBLIC_KEY`، ثم خزّن المفتاح الخاص:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
npm run db:remote
npm run deploy
```

بعد ظهور رابط Worker، ضعه في `push-config.js` داخل `PUSH_API_URL` ثم انشر GitHub Pages مجددًا.

Cron يعمل كل دقيقة. يخزن الخادم الحد الأدنى فقط: اشتراك Push، معرف المهمة، العنوان، النص، ووقت الإرسال.
