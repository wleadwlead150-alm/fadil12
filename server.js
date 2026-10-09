// FADIL TRADING PostgreSQL server.js
// Requires: express, cors, multer, pg, dotenv
// Configure DATABASE_URL and ADMIN_EMAIL / ADMIN_PASSWORD in Railway Variables.
// No database passwords or secret credentials are hard-coded here.

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { Pool } = require('pg');
const cors = require('cors');
const express = require('express');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const scrypt = promisify(crypto.scrypt);
const uploadsDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDirectory, { recursive: true });

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Add the PostgreSQL DATABASE_URL variable in Railway.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDirectory));

async function query(text, params = []) {
  return pool.query(text, params);
}
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
      is_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
      activated_at TIMESTAMPTZ,
      current_course_id BIGINT,
      auth_token TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS courses (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      description VARCHAR(1500) NOT NULL DEFAULT '',
      category VARCHAR(80) NOT NULL DEFAULT 'general',
      thumbnail_path TEXT NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      is_free BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id BIGSERIAL PRIMARY KEY,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      video_url TEXT NOT NULL DEFAULT '',
      video_path TEXT NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS resources (
      id BIGSERIAL PRIMARY KEY,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      lesson_id BIGINT REFERENCES lessons(id) ON DELETE SET NULL,
      title VARCHAR(160) NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS quiz_files (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
      watched_seconds INTEGER NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('monthly','quarterly','annual')),
      payment_proof TEXT NOT NULL DEFAULT '',
      note VARCHAR(500) NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('student','admin')),
      body VARCHAR(1500) NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS news (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      summary VARCHAR(900) NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'تحديث السوق',
      source_url VARCHAR(500) NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(5000) NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
    CREATE INDEX IF NOT EXISTS idx_resources_course_id ON resources(course_id);
    CREATE INDEX IF NOT EXISTS idx_progress_user_course ON progress(user_id, course_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
  `);

  // Ensure the optional initial admin is configured through Railway Variables.
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const existing = await query('SELECT id, role FROM users WHERE email = $1', [ADMIN_EMAIL]);
    if (existing.rowCount === 0) {
      await query(
        `INSERT INTO users (name,email,password_hash,role,is_subscribed,activated_at)
         VALUES ($1,$2,$3,'admin',TRUE,NOW())`,
        ['FADIL Administrator', ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)]
      );
      console.log('Initial admin account created from environment variables.');
    } else if (existing.rows[0].role !== 'admin') {
      await query('UPDATE users SET role = $1, is_subscribed = TRUE, updated_at = NOW() WHERE id = $2', ['admin', existing.rows[0].id]);
    }
  }

  const freeCourse = await query('SELECT id FROM courses WHERE is_free = TRUE LIMIT 1');
  if (freeCourse.rowCount === 0) {
    await query(
      `INSERT INTO courses (title,description,category,is_published,is_free)
       VALUES ($1,$2,$3,TRUE,TRUE)`,
      ['كورس مجاني', 'مدخل مجاني لتعلّم أساسيات التداول وإدارة المخاطر.', 'general']
    );
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDirectory),
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const paymentUpload = multer({
  storage,
  limits: { fileSize: Number(process.env.UPLOAD_MAX_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    callback(allowed.includes(file.mimetype) ? null : new Error('يسمح برفع صور PNG/JPG/WEBP أو ملف PDF فقط.'), allowed.includes(file.mimetype));
  },
});
const contentUpload = multer({
  storage,
  limits: { fileSize: Number(process.env.CONTENT_UPLOAD_MAX_MB || 250) * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(['.mp4','.webm','.mov','.m4v','.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.zip','.rar','.jpg','.jpeg','.png','.webp','.json']);
    if (!allowed.has(path.extname(file.originalname).toLowerCase())) {
      const error = new Error('نوع الملف غير مدعوم. يسمح بالفيديوهات وملفات PDF/Office والصور والملفات المضغوطة.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    isSubscribed: user.is_subscribed, activatedAt: user.activated_at,
    currentCourseId: user.current_course_id,
  };
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}
async function passwordMatches(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, knownHash] = stored.split(':');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(knownHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function publicUploadPath(file) { return file ? `/uploads/${file.filename}` : ''; }
async function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const filename = path.basename(publicPath);
  const absolutePath = path.join(uploadsDirectory, filename);
  if (!absolutePath.startsWith(`${uploadsDirectory}${path.sep}`)) return;
  try { await fs.promises.unlink(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function requireAuth(req, res, next) {
  const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'سجّل الدخول أولاً.' });
  asyncRoute(async (req, res, next) => {
    const result = await query('SELECT * FROM users WHERE auth_token = $1', [token]);
    if (!result.rowCount) return res.status(401).json({ error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' });
    req.user = result.rows[0];
    next();
  })(req, res, next);
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'هذه العملية متاحة للإدارة فقط.' });
  next();
}
function parseId(value) {
  if (!/^\d+$/.test(String(value || ''))) return null;
  return String(value);
}
function idOr400(value, res) {
  const id = parseId(value);
  if (!id) res.status(400).json({ error: 'المعرّف غير صالح.' });
  return id;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  let database = 'not-configured';
  try { await query('SELECT 1'); database = 'connected'; } catch {}
  res.json({ ok: true, database });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'أدخل الاسم والبريد وكلمة مرور من 8 أحرف على الأقل.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const free = await query('SELECT id FROM courses WHERE is_free = TRUE ORDER BY id LIMIT 1');
  const token = crypto.randomBytes(32).toString('hex');
  try {
    const result = await query(
      `INSERT INTO users (name,email,password_hash,role,auth_token,current_course_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name.trim(), normalizedEmail, await hashPassword(password), ADMIN_EMAIL && normalizedEmail === ADMIN_EMAIL ? 'admin' : 'student', token, free.rows[0]?.id || null]
    );
    res.status(201).json({ token, user: publicUser(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'هذا البريد مسجّل مسبقاً.' });
    throw error;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const identifier = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const email = identifier === 'admin' ? ADMIN_EMAIL : identifier;
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !(await passwordMatches(password, user.password_hash))) return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحين.' });
  const token = crypto.randomBytes(32).toString('hex');
  const updated = await query('UPDATE users SET auth_token=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [token, user.id]);
  res.json({ token, user: publicUser(updated.rows[0]) });
}));

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await query('UPDATE users SET auth_token=NULL, updated_at=NOW() WHERE id=$1', [req.user.id]);
  res.status(204).end();
}));
app.get('/api/user-status', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/news', asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM news WHERE is_published=TRUE ORDER BY created_at DESC LIMIT 12')).rows);
}));
app.get('/api/analyses', asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM analyses WHERE is_published=TRUE ORDER BY created_at DESC LIMIT 12')).rows);
}));
app.get('/api/quiz-files', requireAuth, asyncRoute(async (req, res) => {
  if (!req.user.is_subscribed && req.user.role !== 'admin') return res.status(403).json({ error: 'الاختبارات متاحة للعضوية النشطة فقط.' });
  res.json((await query('SELECT * FROM quiz_files ORDER BY created_at DESC')).rows);
}));
app.get('/api/courses', requireAuth, asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM courses WHERE is_published=TRUE ORDER BY created_at DESC')).rows);
}));
app.get('/api/courses/:id/content', requireAuth, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('SELECT * FROM courses WHERE id=$1 AND is_published=TRUE', [id]);
  const course = result.rows[0];
  if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });
  if (!req.user.is_subscribed && req.user.role !== 'admin' && !course.is_free) return res.status(403).json({ error: 'المحتوى متاح للعضوية النشطة فقط. أرسل طلب اشتراكك الآن.' });
  const [lessons, resources] = await Promise.all([
    query('SELECT * FROM lessons WHERE course_id=$1 AND is_published=TRUE ORDER BY created_at ASC', [id]),
    query('SELECT * FROM resources WHERE course_id=$1 ORDER BY created_at DESC', [id]),
  ]);
  res.json({ course, lessons: lessons.rows, resources: resources.rows });
}));
app.post('/api/courses/:id/select', requireAuth, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('SELECT * FROM courses WHERE id=$1 AND is_published=TRUE', [id]);
  const course = result.rows[0];
  if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });
  if (!req.user.is_subscribed && req.user.role !== 'admin' && !course.is_free) return res.status(403).json({ error: 'اختر الكورس بعد تفعيل عضويتك.' });
  await query('UPDATE users SET current_course_id=$1,updated_at=NOW() WHERE id=$2', [id, req.user.id]);
  res.json({ course });
}));
app.get('/api/lessons', requireAuth, asyncRoute(async (req, res) => {
  const lessons = await query('SELECT * FROM lessons WHERE is_published=TRUE ORDER BY created_at DESC');
  res.json({ unlocked: req.user.is_subscribed || req.user.role === 'admin', lessons: lessons.rows });
}));
app.post('/api/lessons/:id/progress', requireAuth, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const lessonResult = await query('SELECT * FROM lessons WHERE id=$1', [id]);
  const lesson = lessonResult.rows[0];
  if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود.' });
  const status = req.body.status === 'completed' ? 'completed' : 'started';
  const seconds = Number(req.body.watchedSeconds || 0);
  const watched = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const result = await query(
    `INSERT INTO progress (user_id,course_id,lesson_id,status,watched_seconds,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id,lesson_id) DO UPDATE SET course_id=EXCLUDED.course_id,status=EXCLUDED.status,
       watched_seconds=EXCLUDED.watched_seconds,completed_at=EXCLUDED.completed_at,updated_at=NOW()
     RETURNING *`,
    [req.user.id, lesson.course_id, lesson.id, status, watched, status === 'completed' ? new Date() : null]
  );
  res.json({ progress: result.rows[0] });
}));

app.post('/api/subscriptions', requireAuth, paymentUpload.single('paymentProof'), asyncRoute(async (req, res) => {
  const plan = ['monthly','quarterly','annual'].includes(req.body.plan) ? req.body.plan : 'monthly';
  const note = typeof req.body.note === 'string' ? req.body.note.slice(0,500) : '';
  const result = await query(
    'INSERT INTO subscriptions (user_id,plan,note,payment_proof) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, plan, note, publicUploadPath(req.file)]
  );
  res.status(201).json({ subscription: result.rows[0] });
}));
app.get('/api/subscriptions/mine', requireAuth, asyncRoute(async (req, res) => {
  res.json((await query('SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id])).rows);
}));
app.post('/api/support/messages', requireAuth, asyncRoute(async (req, res) => {
  if (typeof req.body.body !== 'string' || !req.body.body.trim()) return res.status(400).json({ error: 'لا يمكن إرسال رسالة فارغة.' });
  const result = await query('INSERT INTO messages (user_id,sender_role,body) VALUES ($1,$2,$3) RETURNING *', [req.user.id,'student',req.body.body.trim().slice(0,1500)]);
  res.status(201).json(result.rows[0]);
}));
app.get('/api/support/messages', requireAuth, asyncRoute(async (req, res) => {
  const result = await query('SELECT * FROM messages WHERE user_id=$1 ORDER BY created_at ASC', [req.user.id]);
  await query("UPDATE messages SET is_read=TRUE WHERE user_id=$1 AND sender_role='admin' AND is_read=FALSE", [req.user.id]);
  res.json(result.rows);
}));
app.get('/api/admin/tickets', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await query(`
    SELECT DISTINCT ON (u.id) u.id AS user_id,u.name,u.email,
      to_jsonb(m) AS last_message
    FROM users u JOIN messages m ON m.user_id=u.id
    ORDER BY u.id,m.created_at DESC`);
  res.json(result.rows.map(row => ({ user: { id: row.user_id, name: row.name, email: row.email }, lastMessage: row.last_message })));
}));
app.get('/api/admin/tickets/:userId', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.userId, res); if (!id) return;
  res.json((await query('SELECT * FROM messages WHERE user_id=$1 ORDER BY created_at ASC', [id])).rows);
}));
app.post('/api/admin/tickets/:userId/reply', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.userId, res); if (!id) return;
  if (typeof req.body.body !== 'string' || !req.body.body.trim()) return res.status(400).json({ error: 'اكتب الرد أولاً.' });
  const exists = await query('SELECT id FROM users WHERE id=$1', [id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'المستخدم غير موجود.' });
  const result = await query('INSERT INTO messages (user_id,sender_role,body) VALUES ($1,$2,$3) RETURNING *', [id,'admin',req.body.body.trim().slice(0,1500)]);
  res.status(201).json(result.rows[0]);
}));
app.get('/api/admin/subscriptions', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json((await query(`SELECT s.*, json_build_object('id',u.id,'name',u.name,'email',u.email) AS user_id
    FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`)).rows);
}));
app.patch('/api/admin/subscriptions/:id/approve', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await transaction(async client => {
    const sub = await client.query('UPDATE subscriptions SET status=$1,reviewed_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *', ['approved',id]);
    if (!sub.rowCount) return null;
    await client.query('UPDATE users SET is_subscribed=TRUE,activated_at=NOW(),updated_at=NOW() WHERE id=$1', [sub.rows[0].user_id]);
    return sub.rows[0];
  });
  if (!result) return res.status(404).json({ error: 'طلب الاشتراك غير موجود.' });
  res.json({ subscription: result });
}));
app.get('/api/admin/news', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM news ORDER BY created_at DESC')).rows);
}));
app.post('/api/admin/news', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { title, summary, category, sourceUrl } = req.body;
  if (typeof title !== 'string' || !title.trim() || typeof summary !== 'string' || !summary.trim()) return res.status(400).json({ error: 'أدخل عنوان الخبر وملخصه.' });
  if (sourceUrl && !/^https?:\/\//i.test(String(sourceUrl).trim())) return res.status(400).json({ error: 'رابط المصدر يجب أن يبدأ بـ http:// أو https://.' });
  const result = await query('INSERT INTO news (title,summary,category,source_url) VALUES ($1,$2,$3,$4) RETURNING *', [title.trim().slice(0,160),summary.trim().slice(0,900),typeof category==='string'&&category.trim()?category.trim().slice(0,50):'تحديث السوق',typeof sourceUrl==='string'?sourceUrl.trim().slice(0,500):'']);
  res.status(201).json(result.rows[0]);
}));
app.delete('/api/admin/news/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('DELETE FROM news WHERE id=$1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'الخبر غير موجود.' });
  res.status(204).end();
}));

app.get('/api/admin/courses', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [courses, lessons, resources] = await Promise.all([
    query('SELECT * FROM courses ORDER BY created_at DESC'),
    query('SELECT * FROM lessons ORDER BY created_at DESC'),
    query('SELECT * FROM resources ORDER BY created_at DESC'),
  ]);
  res.json({ courses: courses.rows, lessons: lessons.rows, resources: resources.rows });
}));
app.post('/api/admin/courses', requireAuth, requireAdmin, contentUpload.fields([{ name:'thumbnail',maxCount:1 },{ name:'attachment',maxCount:1 }]), asyncRoute(async (req, res) => {
  if (typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'أدخل اسم الكورس.' });
  const isFree = req.body.isFree === 'true' || req.body.isFree === true;
  const result = await query(
    `INSERT INTO courses (title,description,category,thumbnail_path,attachment_path,is_free)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.body.title.trim().slice(0,160),typeof req.body.description==='string'?req.body.description.trim().slice(0,1500):'',typeof req.body.category==='string'&&req.body.category.trim()?req.body.category.trim().slice(0,80):'general',publicUploadPath(req.files?.thumbnail?.[0]),publicUploadPath(req.files?.attachment?.[0]),isFree]
  );
  res.status(201).json({ course: result.rows[0] });
}));
app.delete('/api/admin/courses/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const courseResult = await query('SELECT * FROM courses WHERE id=$1', [id]);
  const course = courseResult.rows[0];
  if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });
  const [lessons, resources] = await Promise.all([
    query('SELECT * FROM lessons WHERE course_id=$1', [id]),
    query('SELECT * FROM resources WHERE course_id=$1', [id]),
  ]);
  const files = [course.thumbnail_path,course.attachment_path,...lessons.rows.flatMap(item=>[item.video_path,item.attachment_path]),...resources.rows.map(item=>item.file_path)];
  await transaction(async client => {
    await client.query('DELETE FROM progress WHERE course_id=$1', [id]);
    await client.query('UPDATE users SET current_course_id=NULL WHERE current_course_id=$1', [id]);
    await client.query('DELETE FROM resources WHERE course_id=$1', [id]);
    await client.query('DELETE FROM lessons WHERE course_id=$1', [id]);
    await client.query('DELETE FROM courses WHERE id=$1', [id]);
  });
  await Promise.all(files.map(removeUploadedFile));
  res.status(204).end();
}));
app.post('/api/admin/lessons', requireAuth, requireAdmin, contentUpload.fields([{ name:'video',maxCount:1 },{ name:'attachment',maxCount:1 }]), asyncRoute(async (req, res) => {
  if (typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'أدخل اسم المقطع أو الدرس.' });
  let courseId = req.body.courseId || null;
  if (courseId && !await query('SELECT id FROM courses WHERE id=$1',[courseId]).then(r=>r.rowCount)) return res.status(404).json({ error: 'الكورس المحدد غير موجود.' });
  const duration = Math.max(0,Math.floor(Number(req.body.durationSeconds)||0));
  const result = await query(
    `INSERT INTO lessons (course_id,title,description,category,video_url,video_path,attachment_path,duration_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [courseId,req.body.title.trim(),typeof req.body.description==='string'?req.body.description.trim():'',typeof req.body.category==='string'&&req.body.category.trim()?req.body.category.trim():'general',typeof req.body.videoUrl==='string'?req.body.videoUrl.trim():'',publicUploadPath(req.files?.video?.[0]),publicUploadPath(req.files?.attachment?.[0]),duration]
  );
  res.status(201).json({ lesson: result.rows[0] });
}));
app.delete('/api/admin/lessons/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('SELECT * FROM lessons WHERE id=$1',[id]);
  const lesson = result.rows[0];
  if (!lesson) return res.status(404).json({ error: 'المقطع غير موجود.' });
  const resources = await query('SELECT * FROM resources WHERE lesson_id=$1',[id]);
  await transaction(async client => {
    await client.query('DELETE FROM progress WHERE lesson_id=$1',[id]);
    await client.query('DELETE FROM resources WHERE lesson_id=$1',[id]);
    await client.query('DELETE FROM lessons WHERE id=$1',[id]);
  });
  await Promise.all([removeUploadedFile(lesson.video_path),removeUploadedFile(lesson.attachment_path),...resources.rows.map(item=>removeUploadedFile(item.file_path))]);
  res.status(204).end();
}));
app.post('/api/admin/resources', requireAuth, requireAdmin, contentUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file || typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل عنوانه.' });
  if (req.body.courseId && !await query('SELECT id FROM courses WHERE id=$1',[req.body.courseId]).then(r=>r.rowCount)) return res.status(404).json({ error: 'الكورس المحدد غير موجود.' });
  if (req.body.lessonId && !await query('SELECT id FROM lessons WHERE id=$1',[req.body.lessonId]).then(r=>r.rowCount)) return res.status(404).json({ error: 'الدرس المحدد غير موجود.' });
  const result = await query('INSERT INTO resources (course_id,lesson_id,title,file_path,original_name,mime_type,size) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.body.courseId||null,req.body.lessonId||null,req.body.title.trim().slice(0,160),publicUploadPath(req.file),req.file.originalname,req.file.mimetype,req.file.size]);
  res.status(201).json({ resource: result.rows[0] });
}));
app.delete('/api/admin/resources/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('DELETE FROM resources WHERE id=$1 RETURNING *',[id]);
  if (!result.rowCount) return res.status(404).json({ error: 'الملف غير موجود.' });
  await removeUploadedFile(result.rows[0].file_path);
  res.status(204).end();
}));
app.post('/api/admin/quiz-files', requireAuth, requireAdmin, contentUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file || typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل عنوان الاختبار.' });
  const result = await query('INSERT INTO quiz_files (title,file_path,original_name,mime_type,size) VALUES ($1,$2,$3,$4,$5) RETURNING *',[req.body.title.trim().slice(0,160),publicUploadPath(req.file),req.file.originalname,req.file.mimetype,req.file.size]);
  res.status(201).json({ quizFile: result.rows[0] });
}));
app.get('/api/admin/quiz-files', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM quiz_files ORDER BY created_at DESC')).rows);
}));
app.delete('/api/admin/quiz-files/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('DELETE FROM quiz_files WHERE id=$1 RETURNING *',[id]);
  if (!result.rowCount) return res.status(404).json({ error: 'ملف الاختبار غير موجود.' });
  await removeUploadedFile(result.rows[0].file_path);
  res.status(204).end();
}));
app.get('/api/admin/analyses', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json((await query('SELECT * FROM analyses ORDER BY created_at DESC')).rows);
}));
app.post('/api/admin/analyses', requireAuth, requireAdmin, contentUpload.single('attachment'), asyncRoute(async (req, res) => {
  if (typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'أدخل عنوان التحليل.' });
  const result = await query('INSERT INTO analyses (title,body,attachment_path) VALUES ($1,$2,$3) RETURNING *',[req.body.title.trim().slice(0,160),typeof req.body.body==='string'?req.body.body.trim().slice(0,5000):'',publicUploadPath(req.file)]);
  res.status(201).json({ analysis: result.rows[0] });
}));
app.delete('/api/admin/analyses/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('DELETE FROM analyses WHERE id=$1 RETURNING *',[id]);
  if (!result.rowCount) return res.status(404).json({ error: 'التحليل غير موجود.' });
  await removeUploadedFile(result.rows[0].attachment_path);
  res.status(204).end();
}));
app.get('/api/admin/students', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await query(`SELECT u.id,u.name,u.email,u.is_subscribed,u.activated_at,u.current_course_id,u.created_at,
    CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object('id',c.id,'title',c.title) END AS current_course_id
    FROM users u LEFT JOIN courses c ON c.id=u.current_course_id WHERE u.role='student' ORDER BY u.created_at DESC`);
  res.json(result.rows);
}));
app.get('/api/admin/student-performance', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const students = await query(`SELECT u.id,u.name,u.email,u.is_subscribed,u.activated_at,u.current_course_id,u.created_at,c.title AS current_course_title
    FROM users u LEFT JOIN courses c ON c.id=u.current_course_id WHERE u.role='student' ORDER BY u.created_at DESC`);
  const results = [];
  for (const student of students.rows) {
    const [total, progress] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM lessons WHERE is_published=TRUE AND course_id IS NOT DISTINCT FROM $1',[student.current_course_id]),
      query(`SELECT COUNT(*)::int AS watched,COUNT(*) FILTER (WHERE status='completed')::int AS completed
        FROM progress WHERE user_id=$1 AND course_id IS NOT DISTINCT FROM $2`,[student.id,student.current_course_id]),
    ]);
    results.push({
      student: { id: student.id,name: student.name,email: student.email,isSubscribed: student.is_subscribed,activatedAt: student.activated_at,currentCourseId: student.current_course_id,createdAt: student.created_at },
      currentCourse: student.current_course_title || 'لم يتم اختيار كورس',
      totalLessons: total.rows[0].total, watchedLessons: progress.rows[0].watched, completedLessons: progress.rows[0].completed,
    });
  }
  res.json(results);
}));
app.delete('/api/admin/students/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = idOr400(req.params.id, res); if (!id) return;
  const result = await query('DELETE FROM users WHERE id=$1 AND role=$2',[id,'student']);
  if (!result.rowCount) return res.status(404).json({ error: 'الطالب غير موجود.' });
  res.status(204).end();
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `فشل الرفع: ${err.message}` });
  if (err.status === 400) return res.status(400).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'هذا السجل موجود مسبقاً.' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
});

async function startServer() {
  try {
    await initializeDatabase();
    console.log('PostgreSQL connected and tables initialized.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`FADIL TRADING server listening on port ${PORT}`));
}
startServer();
