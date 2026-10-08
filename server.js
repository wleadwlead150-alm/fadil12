require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI;
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

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  isSubscribed: { type: Boolean, default: false },
  activatedAt: Date,
  currentCourseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  authToken: { type: String, select: false },
}, { timestamps: true });

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', maxlength: 1500 },
  category: { type: String, default: 'general', trim: true, maxlength: 80 },
  thumbnailPath: { type: String, default: '' },
  attachmentPath: { type: String, default: '' },
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const lessonSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: { type: String, default: 'general' },
  videoUrl: { type: String, default: '' },
  videoPath: { type: String, default: '' },
  attachmentPath: { type: String, default: '' },
  durationSeconds: { type: Number, default: 0, min: 0 },
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const resourceSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  filePath: { type: String, required: true },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
}, { timestamps: true });

const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
  status: { type: String, enum: ['started', 'completed'], default: 'started' },
  watchedSeconds: { type: Number, default: 0, min: 0 },
  completedAt: Date,
}, { timestamps: true });
progressSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['monthly', 'quarterly', 'annual'], default: 'monthly' },
  paymentProof: { type: String, default: '' },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedAt: Date,
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['student', 'admin'], required: true },
  body: { type: String, required: true, trim: true, maxlength: 1500 },
  isRead: { type: Boolean, default: false },
}, { timestamps: true });

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  summary: { type: String, required: true, trim: true, maxlength: 900 },
  category: { type: String, trim: true, maxlength: 50, default: 'تحديث السوق' },
  sourceUrl: { type: String, trim: true, maxlength: 500, default: '' },
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const quizResultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  moduleId: { type: String, required: true, trim: true, maxlength: 80 },
  moduleTitle: { type: String, required: true, trim: true, maxlength: 160 },
  answers: [{ questionIndex: Number, selectedOption: Number, isCorrect: Boolean }],
  score: { type: Number, required: true, min: 0 },
  totalQuestions: { type: Number, required: true, min: 1 },
}, { timestamps: true });

const quizSchema = new mongoose.Schema({
  moduleId: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  questions: [{ text: { type: String, required: true }, options: [{ type: String, required: true }], correctOption: { type: Number, required: true } }],
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const analysisSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, default: '', maxlength: 5000 },
  attachmentPath: { type: String, default: '' },
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Course = mongoose.model('Course', courseSchema);
const Lesson = mongoose.model('Lesson', lessonSchema);
const Resource = mongoose.model('Resource', resourceSchema);
const Progress = mongoose.model('Progress', progressSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Message = mongoose.model('Message', messageSchema);
const News = mongoose.model('News', newsSchema);
const QuizResult = mongoose.model('QuizResult', quizResultSchema);
const Quiz = mongoose.model('Quiz', quizSchema);
const Analysis = mongoose.model('Analysis', analysisSchema);

const QUIZZES = {
  basics: { title: 'اختبار أساسيات التداول', answers: [1, 0, 2] },
  risk: { title: 'اختبار إدارة رأس المال', answers: [0, 2, 1] },
};

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
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar', '.jpg', '.jpeg', '.png', '.webp']);
    if (!allowedExtensions.has(extension)) { const error = new Error('نوع الملف غير مدعوم. يسمح بالفيديوهات وملفات PDF/Office والصور والملفات المضغوطة.'); error.status = 400; return callback(error); }
    callback(null, true);
  },
});

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, isSubscribed: user.isSubscribed, activatedAt: user.activatedAt, currentCourseId: user.currentCourseId };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function passwordMatches(password, stored) {
  const [salt, knownHash] = stored.split(':');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(knownHash, 'hex'));
}

function publicUploadPath(file) {
  return file ? `/uploads/${file.filename}` : '';
}

async function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const filename = path.basename(publicPath);
  const absolutePath = path.join(uploadsDirectory, filename);
  if (!absolutePath.startsWith(`${uploadsDirectory}${path.sep}`)) return;
  try { await fs.promises.unlink(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function seedDefaultAdmin() {
  const existing = await User.findOne({ email: ADMIN_EMAIL }).select('+passwordHash');
  if (!existing) {
    await User.create({ name: 'FADIL Administrator', email: ADMIN_EMAIL, passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD), role: 'admin', isSubscribed: true, activatedAt: new Date() });
    console.log(`✓ Default admin created: ${ADMIN_EMAIL}`);
  } else if (existing.role !== 'admin') {
    existing.role = 'admin'; existing.isSubscribed = true; await existing.save();
    console.log(`✓ Existing account promoted to admin: ${ADMIN_EMAIL}`);
  }
}

function databaseRequired(_req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'قاعدة البيانات غير متصلة. أضف MONGO_URI صالحاً إلى ملف .env ثم أعد تشغيل الخادم.' });
  }
  next();
}

async function requireAuth(req, res, next) {
  try {
    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'سجّل الدخول أولاً.' });
    const user = await User.findOne({ authToken: token });
    if (!user) return res.status(401).json({ error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'هذه العملية متاحة للإدارة فقط.' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'not-configured' }));

app.post('/api/auth/register', databaseRequired, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'أدخل الاسم والبريد وكلمة مرور من 8 أحرف على الأقل.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ error: 'هذا البريد مسجّل مسبقاً.' });
    const user = await User.create({
      name: name.trim(), email: normalizedEmail, passwordHash: await hashPassword(password),
      role: ADMIN_EMAIL && normalizedEmail === ADMIN_EMAIL ? 'admin' : 'student',
      authToken: crypto.randomBytes(32).toString('hex'),
    });
    res.status(201).json({ token: user.authToken, user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', databaseRequired, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const identifier = email?.trim().toLowerCase();
    const user = await User.findOne({ email: identifier === 'admin' ? ADMIN_EMAIL : identifier }).select('+passwordHash +authToken');
    if (!user || !(await passwordMatches(password || '', user.passwordHash))) return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحين.' });
    user.authToken = crypto.randomBytes(32).toString('hex');
    await user.save();
    res.json({ token: user.authToken, user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', databaseRequired, requireAuth, async (req, res, next) => {
  try { req.user.authToken = undefined; await req.user.save(); res.status(204).end(); } catch (error) { next(error); }
});

app.get('/api/user-status', databaseRequired, requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/news', databaseRequired, async (_req, res, next) => {
  try { res.json(await News.find({ isPublished: true }).sort({ createdAt: -1 }).limit(12)); } catch (error) { next(error); }
});

app.get('/api/analyses', databaseRequired, async (_req, res, next) => {
  try { res.json(await Analysis.find({ isPublished: true }).sort({ createdAt: -1 }).limit(12)); } catch (error) { next(error); }
});

async function submitQuiz(req, res, next) {
  try {
    const moduleId = req.params.moduleId || req.body.moduleId;
    const storedQuiz = await Quiz.findOne({ moduleId });
    const quiz = storedQuiz ? (storedQuiz.isPublished ? { title: storedQuiz.title, answers: storedQuiz.questions.map(question => question.correctOption) } : null) : QUIZZES[moduleId];
    const submittedAnswers = req.body.answers;
    if (!quiz) return res.status(404).json({ error: 'هذا الاختبار غير متاح.' });
    if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== quiz.answers.length || submittedAnswers.some(answer => !Number.isInteger(answer))) {
      return res.status(400).json({ error: 'إجابات الاختبار غير مكتملة أو غير صالحة.' });
    }
    const answers = quiz.answers.map((correctOption, questionIndex) => ({
      questionIndex, selectedOption: submittedAnswers[questionIndex], isCorrect: submittedAnswers[questionIndex] === correctOption,
    }));
    const score = answers.filter(answer => answer.isCorrect).length;
    const result = await QuizResult.create({ userId: req.user._id, moduleId, moduleTitle: quiz.title, answers, score, totalQuestions: quiz.answers.length });
    res.status(201).json({ result: { id: result._id, moduleId: result.moduleId, moduleTitle: result.moduleTitle, score, totalQuestions: quiz.answers.length, createdAt: result.createdAt } });
  } catch (error) { next(error); }
}

app.post('/api/quizzes/submit', databaseRequired, requireAuth, submitQuiz);
app.post('/api/quizzes/:moduleId/submit', databaseRequired, requireAuth, submitQuiz);

app.get('/api/quizzes/mine', databaseRequired, requireAuth, async (req, res, next) => {
  try { res.json(await QuizResult.find({ userId: req.user._id }).select('moduleId moduleTitle score totalQuestions createdAt').sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.get('/api/quizzes', databaseRequired, async (_req, res, next) => {
  try {
    const stored = await Quiz.find().select('moduleId title questions isPublished').lean();
    const storedById = new Map(stored.map(quiz => [quiz.moduleId, quiz]));
    const defaults = Object.entries(QUIZZES).filter(([moduleId]) => !storedById.has(moduleId)).map(([moduleId, quiz]) => ({ moduleId, title: quiz.title, questionCount: quiz.answers.length }));
    const custom = stored.filter(quiz => quiz.isPublished).map(quiz => ({ moduleId: quiz.moduleId, title: quiz.title, questionCount: quiz.questions.length }));
    res.json([...defaults, ...custom]);
  } catch (error) { next(error); }
});

app.get('/api/courses', databaseRequired, requireAuth, async (req, res, next) => {
  try { res.json(await Course.find({ isPublished: true }).sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.get('/api/courses/:id/content', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isSubscribed && req.user.role !== 'admin') return res.status(403).json({ error: 'المحتوى متاح للعضوية النشطة فقط.' });
    const [course, lessons, resources] = await Promise.all([
      Course.findById(req.params.id), Lesson.find({ courseId: req.params.id, isPublished: true }).sort({ createdAt: 1 }), Resource.find({ courseId: req.params.id }).sort({ createdAt: -1 }),
    ]);
    if (!course || !course.isPublished) return res.status(404).json({ error: 'الكورس غير موجود.' });
    res.json({ course, lessons, resources });
  } catch (error) { next(error); }
});

app.post('/api/courses/:id/select', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isSubscribed && req.user.role !== 'admin') return res.status(403).json({ error: 'اختر الكورس بعد تفعيل عضويتك.' });
    const course = await Course.findOne({ _id: req.params.id, isPublished: true });
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });
    await User.findByIdAndUpdate(req.user._id, { currentCourseId: course._id });
    res.json({ course });
  } catch (error) { next(error); }
});

app.get('/api/lessons', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    const lessons = await Lesson.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json({ unlocked: req.user.isSubscribed || req.user.role === 'admin', lessons });
  } catch (error) { next(error); }
});

app.post('/api/lessons/:id/progress', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود.' });
    const status = req.body.status === 'completed' ? 'completed' : 'started';
    const watchedSeconds = Number(req.body.watchedSeconds || 0);
    const progress = await Progress.findOneAndUpdate(
      { userId: req.user._id, lessonId: lesson._id },
      { courseId: lesson.courseId, status, watchedSeconds: Number.isFinite(watchedSeconds) ? Math.max(0, watchedSeconds) : 0, ...(status === 'completed' ? { completedAt: new Date() } : {}) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json({ progress });
  } catch (error) { next(error); }
});

app.post('/api/subscriptions', databaseRequired, requireAuth, paymentUpload.single('paymentProof'), async (req, res, next) => {
  try {
    const subscription = await Subscription.create({
      userId: req.user._id, plan: req.body.plan || 'monthly', note: req.body.note || '',
      paymentProof: req.file ? `/uploads/${req.file.filename}` : '',
    });
    res.status(201).json({ subscription });
  } catch (error) { next(error); }
});

app.get('/api/subscriptions/mine', databaseRequired, requireAuth, async (req, res, next) => {
  try { res.json(await Subscription.find({ userId: req.user._id }).sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.post('/api/support/messages', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    if (!req.body.body?.trim()) return res.status(400).json({ error: 'لا يمكن إرسال رسالة فارغة.' });
    const message = await Message.create({ userId: req.user._id, senderRole: 'student', body: req.body.body.trim() });
    res.status(201).json(message);
  } catch (error) { next(error); }
});

app.get('/api/support/messages', databaseRequired, requireAuth, async (req, res, next) => {
  try {
    const messages = await Message.find({ userId: req.user._id }).sort({ createdAt: 1 });
    await Message.updateMany({ userId: req.user._id, senderRole: 'admin', isRead: false }, { isRead: true });
    res.json(messages);
  } catch (error) { next(error); }
});

app.get('/api/admin/tickets', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 }).populate('userId', 'name email');
    const tickets = [];
    const seen = new Set();
    for (const message of messages) {
      if (!seen.has(String(message.userId._id))) { tickets.push({ user: message.userId, lastMessage: message }); seen.add(String(message.userId._id)); }
    }
    res.json(tickets);
  } catch (error) { next(error); }
});

app.get('/api/admin/tickets/:userId', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try { res.json(await Message.find({ userId: req.params.userId }).sort({ createdAt: 1 })); } catch (error) { next(error); }
});

app.post('/api/admin/tickets/:userId/reply', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!req.body.body?.trim()) return res.status(400).json({ error: 'اكتب الرد أولاً.' });
    const message = await Message.create({ userId: req.params.userId, senderRole: 'admin', body: req.body.body.trim() });
    res.status(201).json(message);
  } catch (error) { next(error); }
});

app.get('/api/admin/subscriptions', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await Subscription.find().populate('userId', 'name email').sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.get('/api/admin/news', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await News.find().sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.post('/api/admin/news', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, summary, category, sourceUrl } = req.body;
    if (!title?.trim() || !summary?.trim()) return res.status(400).json({ error: 'أدخل عنوان الخبر وملخصه.' });
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl.trim())) return res.status(400).json({ error: 'رابط المصدر يجب أن يبدأ بـ http:// أو https://.' });
    const news = await News.create({ title: title.trim(), summary: summary.trim(), category: category?.trim() || 'تحديث السوق', sourceUrl: sourceUrl?.trim() || '' });
    res.status(201).json(news);
  } catch (error) { next(error); }
});

app.delete('/api/admin/news/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const news = await News.findByIdAndDelete(req.params.id);
    if (!news) return res.status(404).json({ error: 'الخبر غير موجود.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/quiz-results', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await QuizResult.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(200)); } catch (error) { next(error); }
});

app.get('/api/admin/courses', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [courses, lessons, resources] = await Promise.all([Course.find().sort({ createdAt: -1 }), Lesson.find().sort({ createdAt: -1 }), Resource.find().sort({ createdAt: -1 })]);
    res.json({ courses, lessons, resources });
  } catch (error) { next(error); }
});

app.post('/api/admin/courses', databaseRequired, requireAuth, requireAdmin, contentUpload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل اسم الكورس.' });
    const course = await Course.create({ title: req.body.title.trim(), description: req.body.description?.trim() || '', category: req.body.category?.trim() || 'general', thumbnailPath: publicUploadPath(req.files?.thumbnail?.[0]), attachmentPath: publicUploadPath(req.files?.attachment?.[0]) });
    res.status(201).json({ course });
  } catch (error) { await Promise.all([removeUploadedFile(publicUploadPath(req.files?.thumbnail?.[0])), removeUploadedFile(publicUploadPath(req.files?.attachment?.[0]))]); next(error); }
});

app.delete('/api/admin/courses/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });
    const [lessons, resources] = await Promise.all([Lesson.find({ courseId: course._id }), Resource.find({ courseId: course._id })]);
    const files = [course.thumbnailPath, course.attachmentPath, ...lessons.flatMap(item => [item.videoPath, item.attachmentPath]), ...resources.map(item => item.filePath)];
    await Promise.all([Course.findByIdAndDelete(course._id), Lesson.deleteMany({ courseId: course._id }), Resource.deleteMany({ courseId: course._id }), Progress.deleteMany({ courseId: course._id }), User.updateMany({ currentCourseId: course._id }, { currentCourseId: null }), ...files.map(removeUploadedFile)]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/admin/lessons', databaseRequired, requireAuth, requireAdmin, contentUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل اسم المقطع أو الدرس.' });
    if (req.body.courseId && !await Course.exists({ _id: req.body.courseId })) return res.status(404).json({ error: 'الكورس المحدد غير موجود.' });
    const lesson = await Lesson.create({ courseId: req.body.courseId || null, title: req.body.title.trim(), description: req.body.description?.trim() || '', category: req.body.category?.trim() || 'general', videoUrl: req.body.videoUrl?.trim() || '', videoPath: publicUploadPath(req.files?.video?.[0]), attachmentPath: publicUploadPath(req.files?.attachment?.[0]), durationSeconds: Number(req.body.durationSeconds || 0) });
    res.status(201).json({ lesson });
  } catch (error) { await Promise.all([removeUploadedFile(publicUploadPath(req.files?.video?.[0])), removeUploadedFile(publicUploadPath(req.files?.attachment?.[0]))]); next(error); }
});

app.delete('/api/admin/lessons/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'المقطع غير موجود.' });
    const resources = await Resource.find({ lessonId: lesson._id });
    await Promise.all([Lesson.findByIdAndDelete(lesson._id), Resource.deleteMany({ lessonId: lesson._id }), Progress.deleteMany({ lessonId: lesson._id }), removeUploadedFile(lesson.videoPath), removeUploadedFile(lesson.attachmentPath), ...resources.map(item => removeUploadedFile(item.filePath))]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/admin/resources', databaseRequired, requireAuth, requireAdmin, contentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.body.title?.trim()) return res.status(400).json({ error: 'اختر ملفاً وأدخل عنوانه.' });
    if (req.body.courseId && !await Course.exists({ _id: req.body.courseId })) return res.status(404).json({ error: 'الكورس المحدد غير موجود.' });
    if (req.body.lessonId && !await Lesson.exists({ _id: req.body.lessonId })) return res.status(404).json({ error: 'الدرس المحدد غير موجود.' });
    const resource = await Resource.create({ courseId: req.body.courseId || null, lessonId: req.body.lessonId || null, title: req.body.title.trim(), filePath: publicUploadPath(req.file), originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size });
    res.status(201).json({ resource });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});

app.delete('/api/admin/resources/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const resource = await Resource.findByIdAndDelete(req.params.id);
    if (!resource) return res.status(404).json({ error: 'الملف غير موجود.' });
    await removeUploadedFile(resource.filePath);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/quizzes', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const stored = await Quiz.find().select('moduleId title isPublished questions createdAt').sort({ createdAt: -1 });
    const ids = new Set(stored.map(item => item.moduleId));
    const defaults = Object.entries(QUIZZES).filter(([moduleId]) => !ids.has(moduleId)).map(([moduleId, quiz]) => ({ moduleId, title: quiz.title, isPublished: true, questions: quiz.answers.map(() => ({})) }));
    res.json([...stored, ...defaults]);
  } catch (error) { next(error); }
});

app.delete('/api/admin/quizzes/:moduleId', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const moduleId = req.params.moduleId;
    const existing = await Quiz.findOne({ moduleId });
    if (!existing && !QUIZZES[moduleId]) return res.status(404).json({ error: 'الاختبار غير موجود.' });
    if (existing) { existing.isPublished = false; await existing.save(); } else { await Quiz.create({ moduleId, title: QUIZZES[moduleId].title, questions: [], isPublished: false }); }
    await QuizResult.deleteMany({ moduleId });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/analyses', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await Analysis.find().sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.post('/api/admin/analyses', databaseRequired, requireAuth, requireAdmin, contentUpload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'أدخل عنوان التحليل.' });
    const analysis = await Analysis.create({ title: req.body.title.trim(), body: req.body.body?.trim() || '', attachmentPath: publicUploadPath(req.file) });
    res.status(201).json({ analysis });
  } catch (error) { if (req.file) await removeUploadedFile(publicUploadPath(req.file)); next(error); }
});

app.delete('/api/admin/analyses/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const analysis = await Analysis.findByIdAndDelete(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'التحليل غير موجود.' });
    await removeUploadedFile(analysis.attachmentPath);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.patch('/api/admin/subscriptions/:id/approve', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ error: 'طلب الاشتراك غير موجود.' });
    subscription.status = 'approved'; subscription.reviewedAt = new Date(); await subscription.save();
    await User.findByIdAndUpdate(subscription.userId, { isSubscribed: true, activatedAt: new Date() });
    res.json({ subscription });
  } catch (error) { next(error); }
});

app.get('/api/admin/students', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await User.find({ role: 'student' }).populate('currentCourseId', 'title').select('name email isSubscribed activatedAt currentCourseId createdAt').sort({ createdAt: -1 })); } catch (error) { next(error); }
});

app.get('/api/admin/student-performance', databaseRequired, requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [students, lessonCounts, progressCounts] = await Promise.all([
      User.find({ role: 'student' }).populate('currentCourseId', 'title').select('name email isSubscribed activatedAt currentCourseId createdAt').sort({ createdAt: -1 }),
      Lesson.aggregate([{ $match: { isPublished: true } }, {$group: { _id: '$courseId', totalLessons: {$sum: 1 } } }]),
      Progress.aggregate([{ $group: { _id: { userId: '$userId', courseId: '$courseId' }, watched: {$sum: 1 }, completed: { $sum: {$cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }]),
    ]);
    const totalByCourse = new Map(lessonCounts.map(item => [String(item._id), item.totalLessons]));
    const progressByStudent = new Map(progressCounts.map(item => [`${item._id.userId}:${item._id.courseId || ''}`, item]));
    res.json(students.map(student => {
      const courseId = student.currentCourseId?._id || null;
      const progress = progressByStudent.get(`${student._id}:${courseId || ''}`) || { watched: 0, completed: 0 };
      return { student, currentCourse: student.currentCourseId?.title || 'لم يتم اختيار كورس', totalLessons: totalByCourse.get(String(courseId)) || 0, watchedLessons: progress.watched, completedLessons: progress.completed };
    }));
  } catch (error) { next(error); }
});

app.delete('/api/admin/students/:id', databaseRequired, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await Promise.all([User.findByIdAndDelete(req.params.id), Subscription.deleteMany({ userId: req.params.id }), Message.deleteMany({ userId: req.params.id }), QuizResult.deleteMany({ userId: req.params.id }), Progress.deleteMany({ userId: req.params.id })]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `فشل الرفع: ${err.message}` });
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: err.message || 'حدث خطأ غير متوقع.' });
});

// [التعديل هنا لجعل السيرفر ينتظر اتصال القاعدة أولاً وتفادي مشاكل التأخير في Render]
async function startServer() {
  try {
    if (MONGO_URI) {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
      console.log('✓ MongoDB connected');
      await seedDefaultAdmin();
    } else {
      console.warn('⚠ MONGO_URI is not set. The interface will run, but database features require configuration.');
    }
  } catch (error) {
    console.warn(`⚠ MongoDB connection error: ${error.message}`);
  }

  app.listen(PORT, () => console.log(`✓ FADIL TRADING is running at http://localhost:${PORT}`));
}

startServer();
