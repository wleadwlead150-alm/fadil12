# FADIL TRADING

منصة تعليم تداول كاملة بواجهة عربية RTL وخادم Express وقاعدة بيانات MongoDB.

## التشغيل

```bash
cd fadil-trading
npm start
```

افتح `http://localhost:3001`.

## الإعدادات

تُقرأ المتغيرات من `.env`:

```env
PORT=3001
MONGO_URI=mongodb://127.0.0.1:27017/fadil_trading
ADMIN_EMAIL=admin@fadiltrading.local
UPLOAD_MAX_MB=5
```

الحساب الذي يسجل بالبريد المحدد في `ADMIN_EMAIL` يصبح حساب أدمن تلقائيًا. غيّر البريد إلى بريد الإدارة الفعلي قبل الاستخدام العام.

## المسارات الرئيسية

- `/home.html` واجهة الطالب
- `/admin.html` لوحة الإدارة
- `/api/health` فحص الخادم وقاعدة البيانات

## الإنتاج

استخدم MongoDB Atlas أو MongoDB مُدارًا، وضع URI الحقيقي في متغير `MONGO_URI` لدى مزود الاستضافة. شغّل التطبيق عبر `npm start` مع `NODE_ENV=production`، واجعل الملفات المرفوعة على تخزين دائم (S3 أو Cloudinary) عند النشر على منصة عديمة الحالة.
