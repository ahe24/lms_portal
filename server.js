import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { injectUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import instructorRoutes from './routes/instructor.js';
import studentRoutes from './routes/student.js';
import proxyRoutes from './routes/proxy.js';
import materialsRoutes from './routes/materials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

// ─── View Engine ───
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Middleware ───
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Attach Socket.io to request
app.use((req, res, next) => {
    req.io = io;
    next();
});

import SQLiteStoreFactory from 'connect-sqlite3';

const SQLiteStore = SQLiteStoreFactory(session);

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './db'
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true
    }
}));

app.use(injectUser);

// ─── Routes ───
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/instructor', instructorRoutes);
app.use('/student', studentRoutes);
app.use(proxyRoutes);
app.use(materialsRoutes);

// Home redirect
app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/auth/login');
    switch (req.session.user.role) {
        case 'super_admin': return res.redirect('/admin');
        case 'instructor': return res.redirect('/instructor');
        case 'student': return res.redirect('/student');
        default: return res.redirect('/auth/login');
    }
});

// ─── Socket.io Sync Logic ───
io.on('connection', (socket) => {
    socket.on('join-session', ({ materialId, courseId }) => {
        const roomId = `material-${materialId}-course-${courseId}`;
        socket.join(roomId);
        console.log(`User joined sync room: ${roomId}`);
    });

    socket.on('instructor-slide-change', ({ materialId, courseId, page }) => {
        const roomId = `material-${materialId}-course-${courseId}`;
        // Broadcast to everyone else in the room (students)
        socket.to(roomId).emit('sync-slide', { page });
    });

    socket.on('instructor-laser', (data) => {
        const roomId = `material-${data.materialId}-course-${data.courseId}`;
        // data: { show, x, y }
        socket.to(roomId).emit('laser-pointer', data);
    });
});

// ─── Start ───
httpServer.listen(PORT, HOST, () => {
    console.log(`\n🚀 LMS Portal running at http://${HOST}:${PORT}`);
    console.log(`   환경: HOST=${HOST}, PORT=${PORT}\n`);
});
