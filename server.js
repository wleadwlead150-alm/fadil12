require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const cors = require('cors');
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_ADMIN_EMAIL = 'admin@fadildemo.com';
const DEFAULT_ADMIN_PASSWORD = '123456';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const scrypt = promisify(crypto.scrypt);
const uploadsDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDirectory, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDirectory));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.PG_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); } finally { client.release(); }
}

function toFrontend(row) {
  if (!row) return row;
  return {
    ...row, _id: row.id, createdAt: row.created_at, courseId: row.course_id, lessonId: row.lesson_id, userId: row.user_id,
    thumbnailPath: row.thumbnail_path, attachmentPath: row.attachment_path, videoUrl: row.video_url, videoPath: row.video_path,
    durationSeconds: row.duration_seconds, isPublished: row.is_published, isFree: row.is_free, isSubscribed: row.is_subscribed,
    isRead: row.is_read, paymentProof: row.payment_proof, senderRole: row.sender_role, currentCourseId: row.current_course_id,
    originalName: row.original_name, mimeType: row.mime_type
  };
}
function toFrontendList(rows) { return rows.map(toFrontend); }

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users ( id SERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(20) DEFAULT 'student', is_subscribed BOOLEAN DEFAULT FALSE, activated_at TIMESTAMP, current_course_id INTEGER, auth_token TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS courses ( id SERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, description TEXT DEFAULT '', category VARCHAR(80) DEFAULT 'general', thumbnail_path TEXT DEFAULT '', attachment_path TEXT DEFAULT '', is_published BOOLEAN DEFAULT TRUE, is_free BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS lessons ( id SERIAL PRIMARY KEY, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'general', video_url TEXT DEFAULT '', video_path TEXT DEFAULT '', attachment_path TEXT DEFAULT '', duration_seconds INTEGER DEFAULT 0, is_published BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS resources ( id SERIAL PRIMARY KEY, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE, title VARCHAR(160) NOT NULL, file_path TEXT NOT NULL, original_name TEXT DEFAULT '', mime_type TEXT DEFAULT '', size BIGINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS quiz_files ( id SERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, file_path TEXT NOT NULL, original_name TEXT DEFAULT '', mime_type TEXT DEFAULT '', size BIGINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS result_files ( id SERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, file_path TEXT NOT NULL, original_name TEXT DEFAULT '', mime_type TEXT DEFAULT '', size BIGINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS progress ( id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE, status VARCHAR(20) DEFAULT 'started', watched_seconds INTEGER DEFAULT 0, completed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, CONSTRAINT unique_user_lesson UNIQUE(user_id, lesson_id) );
    CREATE TABLE IF NOT EXISTS subscriptions ( id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, plan VARCHAR(20) DEFAULT 'monthly', payment_proof TEXT DEFAULT '', note TEXT DEFAULT '', status VARCHAR(20) DEFAULT 'pending', reviewed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS messages ( id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, sender_role VARCHAR(20) NOT NULL, body TEXT NOT NULL, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS news ( id SERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, summary TEXT NOT NULL, category VARCHAR(50) DEFAULT 'تحديث السوق', source_url TEXT DEFAULT '', is_published BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
    CREATE TABLE IF NOT EXISTS analyses ( id SERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, body TEXT DEFAULT '', attachment_path TEXT DEFAULT '', is_published BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );
  `);
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDirectory),
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

const paymentUpload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, true) });
const contentUpload = multer({ storage, limits: { fileSize: 250 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, true) });

function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, isSubscribed: user.is_subscribed, activatedAt: user.activated_at, currentCourseId: user.current_course_id }; }
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); const hash = (await scrypt(password, salt, 64)).toString('hex'); return `${salt}:${hash}`; }
async function passwordMatches(password, stored) { const [salt, knownHash] = stored.split(':'); const hash = (await scrypt(password, salt, 64)).toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(knownHash, 'hex')); }
function publicUploadPath(file) { return file ? `/uploads/${file.filename}` : ''; }

async function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const filename = path.basename(publicPath); const absolutePath = path.join(uploadsDirectory, filename);
  if (!absolutePath.startsWith(`${uploadsDirectory}${path.sep}`)) return;
  try { await fs.promises.unlink(absolutePath); } catch (error) { if (error.code !== 'ENOENT') console.error('Error deleting file:', error); }
}

async function seedDefaultAdmin() {
  const res = await query('SELECT * FROM users WHERE email = $1', [ADMIN_EMAIL]);
  if (res.rows.length === 0) {
    const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    await query(`INSERT INTO users (name, email, password_hash, role, is_subscribed, activated_at) VALUES ($1, $2, $3, 'admin', TRUE, CURRENT_TIMESTAMP)`, ['FADIL Administrator', ADMIN_EMAIL, passwordHash]);
  } else if (res.rows[0].role !== 'admin') { await query(`UPDATE users SET role = 'admin', is_subscribed = TRUE WHERE email = $1`, [ADMIN_EMAIL]); }
}

async function ensureFreeCourse() {
  const res = await query('SELECT * FROM courses WHERE is_free = TRUE LIMIT 1');
  if (res.rows.length === 0) { await query(`INSERT INTO courses (title, description, category, is_published, is_free) VALUES ($1, $2, $3, $4, $5)`, ['كورس مجاني', 'مدخل مجاني لتعلّم أساسيات التداول وإدارة المخاطر.', 'general', true, true]); }
}

async function requireAuth(req, res, next) {
  try {
    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'سجّل الدخول أولاً.' });
    const resUser = await query('SELECT * FROM users WHERE auth_token = $1', [token]);
    if (resUser.rows.length === 0) return res.status(401).json({ error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' });
    req.user = resUser.rows[0];
    next();
  } catch (error) { next(error); }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'هذه العملية متاحة للإدارة فقط.' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'أدخل الاسم والبريد وكلمة مرور من 8 أحرف على الأقل.' });
    const normalizedEmail = email.trim().toLowerCase();
    const checkUser = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (checkUser.rows.length > 0) return res.status(409).json({ error: 'هذا البريد مسجّل مسبقاً.' });
    const freeCourseRes = await query('SELECT id FROM courses WHERE is_free = TRUE LIMIT 1');
    const freeCourseId = freeCourseRes.rows.length > 0 ? freeCourseRes.rows[0].id : null;
    const passwordHash = await hashPassword(password);
    const authToken = crypto.randomBytes(32).toString('hex');
    const role = ADMIN_EMAIL && normalizedEmail === ADMIN_EMAIL ? 'admin' : 'student';
    const newUserRes = await query(`INSERT INTO users (name, email, password_hash, role, auth_token, is_subscribed, current_course_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [name.trim(), normalizedEmail, passwordHash, role, authToken, role === 'admin', freeCourseId]);
    res.status(201).json({ token: authToken, user: publicUser(newUserRes.rows[0]) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const identifier = email?.trim().toLowerCase();
    const targetEmail = identifier === 'admin' ? ADMIN_EMAIL : identifier;
    const resUser = await query('SELECT * FROM users WHERE email = $1', [targetEmail]);
    if (resUser.rows.length === 0 || !(await passwordMatches(password || '', resUser.rows[0].password_hash))) return res.status(401).json({ error: 'البيانات غير صحيحة.' });
    const authToken = crypto.randomBytes(32).toString('hex');
    await query('UPDATE users SET auth_token = $1 WHERE id = $2', [authToken, resUser.rows[0].id]);
    const user = resUser.rows[0]; user.auth_token = authToken;
    res.json({ token: authToken, user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => { try { await query('UPDATE users SET auth_token = NULL WHERE id = $1', [req.user.id]); res.status(204).end(); } catch (error) { next(error); } });
app.get('/api/user-status', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/news', async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM news WHERE is_published = TRUE ORDER BY created_at DESC LIMIT 12')).rows)); } catch (error) { next(error); } });
app.get('/api/analyses', async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM analyses WHERE is_published = TRUE ORDER BY created_at DESC LIMIT 12')).rows)); } catch (error) { next(error); } });

app.get('/api/quiz-files', requireAuth, async (req, res, next) => {
  try { if (!req.user.is_subscribed && req.user.role !== 'admin') return res.status(403).json({ error: 'متاحة للعضوية النشطة فقط.' }); res.json(toFrontendList((await query('SELECT * FROM quiz_files ORDER BY created_at DESC')).rows)); } catch (error) { next(error); }
});

app.get('/api/result-files', requireAuth, async (req, res, next) => {
  try { if (!req.user.is_subscribed && req.user.role !== 'admin') return res.status(403).json({ error: 'النتائج للعضوية النشطة فقط.' }); res.json(toFrontendList((await query('SELECT * FROM result_files ORDER BY created_at DESC')).rows)); } catch (error) { next(error); }
});

app.get('/api/courses', async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM courses WHERE is_published = TRUE ORDER BY created_at DESC')).rows)); } catch (error) { next(error); } });

app.get('/api/courses/:id/content', requireAuth, async (req, res, next) => {
  try {
    const courseRes = await query('SELECT * FROM courses WHERE id = $1', [req.params.id]);
    if (courseRes.rows.length === 0 || !courseRes.rows[0].is_published) return res.status(404).json({ error: 'الكورس غير موجود.' });
    const course = toFrontend(courseRes.rows[0]);
    if (!req.user.is_subscribed && req.user.role !== 'admin' && !course.isFree) return res.status(403).json({ error: 'المحتوى متاح للعضوية النشطة فقط.' });
    const [lessonsRes, resourcesRes] = await Promise.all([ query('SELECT * FROM lessons WHERE course_id = $1 AND is_published = TRUE ORDER BY created_at ASC', [req.params.id]), query('SELECT * FROM resources WHERE course_id = $1 ORDER BY created_at DESC', [req.params.id]) ]);
    res.json({ course, lessons: toFrontendList(lessonsRes.rows), resources: toFrontendList(resourcesRes.rows) });
  } catch (error) { next(error); }
});

app.post('/api/courses/:id/select', requireAuth, async (req, res, next) => {
  try {
    const courseRes = await query('SELECT * FROM courses WHERE id = $1 AND is_published = TRUE', [req.params.id]);
    if (courseRes.rows.length === 0) return res.status(404).json({ error: 'الكورس غير موجود.' });
    const course = courseRes.rows[0];
    if (!req.user.is_subscribed && req.user.role !== 'admin' && !course.is_free) return res.status(403).json({ error: 'اختر الكورس بعد تفعيل عضويتك.' });
    await query('UPDATE users SET current_course_id = $1 WHERE id = $2', [course.id, req.user.id]); res.json({ course: toFrontend(course) });
  } catch (error) { next(error); }
});

app.get('/api/lessons', requireAuth, async (req, res, next) => { try { res.json({ unlocked: req.user.is_subscribed || req.user.role === 'admin', lessons: toFrontendList((await query('SELECT * FROM lessons WHERE is_published = TRUE ORDER BY created_at DESC')).rows) }); } catch (error) { next(error); } });

app.post('/api/lessons/:id/progress', requireAuth, async (req, res, next) => {
  try {
    const lessonRes = await query('SELECT * FROM lessons WHERE id = $1', [req.params.id]);
    if (lessonRes.rows.length === 0) return res.status(404).json({ error: 'الدرس غير موجود.' });
    const lesson = lessonRes.rows[0];
    const status = req.body.status === 'completed' ? 'completed' : 'started';
    const watchedSeconds = Number(req.body.watchedSeconds || 0);
    const validWatched = Number.isFinite(watchedSeconds) ? Math.max(0, watchedSeconds) : 0;
    const completedAt = status === 'completed' ? new Date() : null;
    const progressRes = await query(`INSERT INTO progress (user_id, course_id, lesson_id, status, watched_seconds, completed_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, lesson_id) DO UPDATE SET status = EXCLUDED.status, watched_seconds = EXCLUDED.watched_seconds, completed_at = EXCLUDED.completed_at RETURNING *`, [req.user.id, lesson.course_id, lesson.id, status, validWatched, completedAt]);
    res.json({ progress: toFrontend(progressRes.rows[0]) });
  } catch (error) { next(error); }
});

app.post('/api/subscriptions', requireAuth, paymentUpload.single('paymentProof'), async (req, res, next) => {
  try {
    const subRes = await query(`INSERT INTO subscriptions (user_id, plan, payment_proof, note, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING *`, [req.user.id, req.body.plan || 'monthly', req.file ? `/uploads/${req.file.filename}` : '', req.body.note || '']);
    res.status(201).json({ subscription: toFrontend(subRes.rows[0]) });
  } catch (error) { next(error); }
});

app.get('/api/subscriptions/mine', requireAuth, async (req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id])).rows)); } catch (error) { next(error); } });

app.post('/api/support/messages', requireAuth, async (req, res, next) => {
  try {
    if (!req.body.body?.trim()) return res.status(400).json({ error: 'لا يمكن إرسال رسالة فارغة.' });
    const msgRes = await query(`INSERT INTO messages (user_id, sender_role, body) VALUES ($1, 'student', $2) RETURNING *`, [req.user.id, req.body.body.trim()]);
    res.status(201).json(toFrontend(msgRes.rows[0]));
  } catch (error) { next(error); }
});

app.get('/api/support/messages', requireAuth, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
    await query('UPDATE messages SET is_read = TRUE WHERE user_id = $1 AND sender_role = $2 AND is_read = FALSE', [req.user.id, 'admin']);
    res.json(toFrontendList(result.rows));
  } catch (error) { next(error); }
});

// إعدادات الإدارة
app.get('/api/admin/tickets', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const result = await query(`SELECT DISTINCT ON (m.user_id) m.*, u.name as user_name, u.email as user_email FROM messages m JOIN users u ON m.user_id = u.id ORDER BY m.user_id, m.created_at DESC`);
    res.json(result.rows.map(row => ({ user: { _id: row.user_id, id: row.user_id, name: row.user_name, email: row.user_email }, lastMessage: toFrontend(row) })));
  } catch (error) { next(error); }
});
app.get('/api/admin/tickets/:userId', requireAuth, requireAdmin, async (req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC', [req.params.userId])).rows)); } catch (error) { next(error); } });
app.post('/api/admin/tickets/:userId/reply', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!req.body.body?.trim()) return res.status(400).json({ error: 'اكتب الرد أولاً.' });
    const msgRes = await query(`INSERT INTO messages (user_id, sender_role, body) VALUES ($1, 'admin', $2) RETURNING *`, [req.params.userId, req.body.body.trim()]);
    res.status(201).json(toFrontend(msgRes.rows[0]));
  } catch (error) { next(error); }
});

app.get('/api/admin/subscriptions', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const result = await query(`SELECT s.*, u.name as user_name, u.email as user_email FROM subscriptions s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC`);
    res.json(result.rows.map(row => ({ ...toFrontend(row), userId: { _id: row.user_id, id: row.user_id, name: row.user_name, email: row.user_email } })));
  } catch (error) { next(error); }
});
app.patch('/api/admin/subscriptions/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const subRes = await query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
    if (subRes.rows.length === 0) return res.status(404).json({ error: 'طلب الاشتراك غير موجود.' });
    const sub = subRes.rows[0];
    await query('UPDATE subscriptions SET status = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2', ['approved', sub.id]);
    await query('UPDATE users SET is_subscribed = TRUE, activated_at = CURRENT_TIMESTAMP WHERE id = $1', [sub.user_id]);
    res.json({ subscription: toFrontend({ ...sub, status: 'approved' }) });
  } catch (error) { next(error); }
});

app.get('/api/admin/news', requireAuth, requireAdmin, async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM news ORDER BY created_at DESC')).rows)); } catch (error) { next(error); } });
app.post('/api/admin/news', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, summary, category, sourceUrl } = req.body;
    if (!title?.trim() || !summary?.trim()) return res.status(400).json({ error: 'أدخل عنوان الخبر وملخصه.' });
    const newsRes = await query(`INSERT INTO news (title, summary, category, source_url) VALUES ($1, $2, $3, $4) RETURNING *`, [title.trim(), summary.trim(), category?.trim() || 'تحديث السوق', sourceUrl?.trim() || '']);
    res.status(201).json(toFrontend(newsRes.rows[0]));
  } catch (error) { next(error); }
});
app.delete('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res, next) => { try { const result = await query('DELETE FROM news WHERE id = $1 RETURNING id', [req.params.id]); if (result.rows.length === 0) return res.status(404).json({ error: 'الخبر غير موجود.' }); res.status(204).end(); } catch (error) { next(error); } });

app.get('/api/admin/courses', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [courses, lessons, resources] = await Promise.all([ query('SELECT * FROM courses ORDER BY created_at DESC'), query('SELECT * FROM lessons ORDER BY created_at DESC'), query('SELECT * FROM resources ORDER BY created_at DESC') ]);
    res.json({ courses: toFrontendList(courses.rows), lessons: toFrontendList(lessons.rows), resources: toFrontendList(resources.rows) });
  } catch (error) { next(error); }
});
app.post('/api/admin/courses', requireAuth, requireAdmin, contentUpload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل اسم الكورس.' });
    const isFree = req.body.isFree === 'true' || req.body.isFree === true;
    const courseRes = await query(`INSERT INTO courses (title, description, category, thumbnail_path, attachment_path, is_free) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [req.body.title.trim(), req.body.description?.trim() || '', req.body.category?.trim() || 'general', publicUploadPath(req.files?.thumbnail?.[0]), publicUploadPath(req.files?.attachment?.[0]), isFree]);
    res.status(201).json({ course: toFrontend(courseRes.rows[0]) });
  } catch (error) { await Promise.all([removeUploadedFile(publicUploadPath(req.files?.thumbnail?.[0])), removeUploadedFile(publicUploadPath(req.files?.attachment?.[0]))]); next(error); }
});
app.delete('/api/admin/courses/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const courseRes = await query('SELECT * FROM courses WHERE id = $1', [req.params.id]);
    if (courseRes.rows.length === 0) return res.status(404).json({ error: 'الكورس غير موجود.' });
    const course = courseRes.rows[0];
    const lessonsRes = await query('SELECT video_path, attachment_path FROM lessons WHERE course_id = $1', [course.id]);
    const resourcesRes = await query('SELECT file_path FROM resources WHERE course_id = $1', [course.id]);
    const filesToDelete = [ course.thumbnail_path, course.attachment_path, ...lessonsRes.rows.flatMap(l => [l.video_path, l.attachment_path]), ...resourcesRes.rows.map(r => r.file_path) ];
    await query('DELETE FROM courses WHERE id = $1', [course.id]);
    await query('UPDATE users SET current_course_id = NULL WHERE current_course_id = $1', [course.id]);
    await Promise.all(filesToDelete.map(removeUploadedFile));
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/admin/lessons', requireAuth, requireAdmin, contentUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل اسم الدرس.' });
    const lessonRes = await query(`INSERT INTO lessons (course_id, title, description, category, video_url, video_path, attachment_path, duration_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [req.body.courseId || null, req.body.title.trim(), req.body.description?.trim() || '', req.body.category?.trim() || 'general', req.body.videoUrl?.trim() || '', publicUploadPath(req.files?.video?.[0]), publicUploadPath(req.files?.attachment?.[0]), Number(req.body.durationSeconds || 0)]);
    res.status(201).json({ lesson: toFrontend(lessonRes.rows[0]) });
  } catch (error) { await Promise.all([removeUploadedFile(publicUploadPath(req.files?.video?.[0])), removeUploadedFile(publicUploadPath(req.files?.attachment?.[0]))]); next(error); }
});
app.delete('/api/admin/lessons/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const lessonRes = await query('SELECT * FROM lessons WHERE id = $1', [req.params.id]);
    if (lessonRes.rows.length === 0) return res.status(404).json({ error: 'المقطع غير موجود.' });
    const lesson = lessonRes.rows[0];
    const resourcesRes = await query('SELECT file_path FROM resources WHERE lesson_id = $1', [lesson.id]);
    const filesToDelete = [lesson.video_path, lesson.attachment_path, ...resourcesRes.rows.map(r => r.file_path)];
    await query('DELETE FROM lessons WHERE id = $1', [lesson.id]);
    await Promise.all(filesToDelete.map(removeUploadedFile));
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/admin/resources', requireAuth, requireAdmin, contentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.body.title?.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل عنوانه.' });
    const resourceRes = await query(`INSERT INTO resources (course_id, lesson_id, title, file_path, original_name, mime_type, size) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [req.body.courseId || null, req.body.lessonId || null, req.body.title.trim(), publicUploadPath(req.file), req.file.originalname, req.file.mimetype, req.file.size]);
    res.status(201).json({ resource: toFrontend(resourceRes.rows[0]) });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});
app.delete('/api/admin/resources/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const resourceRes = await query('DELETE FROM resources WHERE id = $1 RETURNING file_path', [req.params.id]);
    if (resourceRes.rows.length === 0) return res.status(404).json({ error: 'الملف غير موجود.' });
    await removeUploadedFile(resourceRes.rows[0].file_path); res.status(204).end();
  } catch (error) { next(error); }
});

// الاختبارات
app.post('/api/admin/quiz-files', requireAuth, requireAdmin, contentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.body.title?.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل عنوان الاختبار.' });
    const quizRes = await query(`INSERT INTO quiz_files (title, file_path, original_name, mime_type, size) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [req.body.title.trim(), publicUploadPath(req.file), req.file.originalname, req.file.mimetype, req.file.size]);
    res.status(201).json({ quizFile: toFrontend(quizRes.rows[0]) });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});
app.get('/api/admin/quiz-files', requireAuth, requireAdmin, async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM quiz_files ORDER BY created_at DESC')).rows)); } catch (error) { next(error); } });
app.delete('/api/admin/quiz-files/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const quizRes = await query('DELETE FROM quiz_files WHERE id = $1 RETURNING file_path', [req.params.id]);
    if (quizRes.rows.length === 0) return res.status(404).json({ error: 'الملف غير موجود.' });
    await removeUploadedFile(quizRes.rows[0].file_path); res.status(204).end();
  } catch (error) { next(error); }
});

// نتائج الطلاب (الجديدة)
app.post('/api/admin/result-files', requireAuth, requireAdmin, contentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.body.title?.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل العنوان.' });
    const resultRes = await query(`INSERT INTO result_files (title, file_path, original_name, mime_type, size) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [req.body.title.trim(), publicUploadPath(req.file), req.file.originalname, req.file.mimetype, req.file.size]);
    res.status(201).json({ resultFile: toFrontend(resultRes.rows[0]) });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});
app.get('/api/admin/result-files', requireAuth, requireAdmin, async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM result_files ORDER BY created_at DESC')).rows)); } catch (error) { next(error); } });
app.delete('/api/admin/result-files/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const resFile = await query('DELETE FROM result_files WHERE id = $1 RETURNING file_path', [req.params.id]);
    if (resFile.rows.length === 0) return res.status(404).json({ error: 'الملف غير موجود.' });
    await removeUploadedFile(resFile.rows[0].file_path); res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/analyses', requireAuth, requireAdmin, async (_req, res, next) => { try { res.json(toFrontendList((await query('SELECT * FROM analyses ORDER BY created_at DESC')).rows)); } catch (error) { next(error); } });
app.post('/api/admin/analyses', requireAuth, requireAdmin, contentUpload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل عنوان التحليل.' });
    const analysisRes = await query(`INSERT INTO analyses (title, body, attachment_path) VALUES ($1, $2, $3) RETURNING *`, [req.body.title.trim(), req.body.body?.trim() || '', publicUploadPath(req.file)]);
    res.status(201).json({ analysis: toFrontend(analysisRes.rows[0]) });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});
app.delete('/api/admin/analyses/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const analysisRes = await query('DELETE FROM analyses WHERE id = $1 RETURNING attachment_path', [req.params.id]);
    if (analysisRes.rows.length === 0) return res.status(404).json({ error: 'التحليل غير موجود.' });
    await removeUploadedFile(analysisRes.rows[0].attachment_path); res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/student-performance', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT u.id as user_id, u.name, u.email, u.activated_at, u.is_subscribed, c.title as current_course,
      (SELECT COUNT(*) FROM lessons WHERE course_id = u.current_course_id AND is_published = TRUE) as total_lessons,
      (SELECT COUNT(*) FROM progress WHERE user_id = u.id AND course_id = u.current_course_id) as watched_lessons,
      (SELECT COUNT(*) FROM progress WHERE user_id = u.id AND course_id = u.current_course_id AND status = 'completed') as completed_lessons
      FROM users u LEFT JOIN courses c ON u.current_course_id = c.id WHERE u.role = 'student' ORDER BY u.created_at DESC
    `);
    res.json(rows.rows.map(r => ({ student: { _id: r.user_id, name: r.name, email: r.email, activatedAt: r.activated_at, isSubscribed: r.is_subscribed }, currentCourse: r.current_course || 'لم يتم اختيار كورس', totalLessons: parseInt(r.total_lessons) || 0, watchedLessons: parseInt(r.watched_lessons) || 0, completedLessons: parseInt(r.completed_lessons) || 0 })));
  } catch (error) { next(error); }
});

app.get('/api/admin/students', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const result = await query(`SELECT u.id, u.name, u.email, u.is_subscribed, u.activated_at, u.current_course_id, u.created_at, c.title as course_title FROM users u LEFT JOIN courses c ON u.current_course_id = c.id WHERE u.role = 'student' ORDER BY u.created_at DESC`);
    res.json(result.rows.map(row => ({ ...toFrontend(row), currentCourseId: row.course_title ? { _id: row.current_course_id, title: row.course_title } : null })));
  } catch (error) { next(error); }
});

app.delete('/api/admin/students/:id', requireAuth, requireAdmin, async (req, res, next) => { try { await query('DELETE FROM users WHERE id = $1', [req.params.id]); res.status(204).end(); } catch (error) { next(error); } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `فشل الرفع: ${err.message}` });
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(err); res.status(500).json({ error: err.message || 'حدث خطأ غير متوقع.' });
});

async function startServer() {
  try {
    await initDatabase();
    await seedDefaultAdmin();
    await ensureFreeCourse();
    console.log('✓ PostgreSQL connected and all tables initialized successfully');
    app.listen(PORT, () => console.log(`✓ FADIL TRADING is running at http://localhost:${PORT}`));
  } catch (err) { console.error('Database Initialization Error:', err); }
}

startServer();
