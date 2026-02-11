import { Router } from 'express';
import { getDb } from '../lib/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('super_admin'));

// ─── 대시보드 ───
router.get('/', (req, res) => {
    const db = getDb();
    const stats = {
        totalUsers: db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
        pendingInstructors: db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role='instructor' AND is_approved=0").get().cnt,
        totalCourses: db.prepare('SELECT COUNT(*) as cnt FROM courses').get().cnt,
        totalSites: db.prepare('SELECT COUNT(*) as cnt FROM lecture_sites').get().cnt,
    };
    res.render('admin/dashboard', { title: '관리자 대시보드', stats });
});

// ─── 강사 승인 관리 ───
router.get('/instructors', (req, res) => {
    const db = getDb();
    const instructors = db.prepare("SELECT * FROM users WHERE role='instructor' ORDER BY created_at DESC").all();
    res.render('admin/instructors', { title: '강사 관리', instructors });
});

router.post('/instructors/:id/approve', (req, res) => {
    const db = getDb();
    db.prepare('UPDATE users SET is_approved = 1 WHERE id = ? AND role = ?').run(req.params.id, 'instructor');
    res.redirect('/admin/instructors');
});

router.post('/instructors/:id/reject', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ? AND role = ? AND is_approved = 0').run(req.params.id, 'instructor');
    res.redirect('/admin/instructors');
});

router.post('/instructors/:id/delete', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(req.params.id, 'instructor');
    res.redirect('/admin/instructors');
});

// ─── 전체 계정 관리 ───
router.get('/users', (req, res) => {
    const db = getDb();
    const users = db.prepare("SELECT * FROM users WHERE role != 'super_admin' ORDER BY role, created_at DESC").all();
    res.render('admin/users', { title: '계정 관리', users });
});

router.post('/users/:id/delete', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (user && user.role !== 'super_admin') {
        db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(req.params.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    }
    res.redirect('/admin/users');
});

// ─── 강의 사이트 관리 ───
router.get('/sites', (req, res) => {
    const db = getDb();
    const sites = db.prepare('SELECT * FROM lecture_sites ORDER BY created_at DESC').all();
    res.render('admin/sites', { title: '강의 사이트 관리', sites });
});

router.post('/sites', (req, res) => {
    const { slug, name, url, description } = req.body;
    const db = getDb();
    try {
        db.prepare('INSERT INTO lecture_sites (slug, name, url, description, creator_id) VALUES (?, ?, ?, ?, ?)')
            .run(slug, name, url, description, req.session.user.id);
    } catch (e) {
        // slug duplicate - ignore
    }
    res.redirect('/admin/sites');
});

router.post('/sites/:id/delete', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM lecture_sites WHERE id = ?').run(req.params.id);
    res.redirect('/admin/sites');
});

// ─── 강의 사이트 수정 ───
router.get('/sites/:id/edit', (req, res) => {
    const db = getDb();
    const site = db.prepare('SELECT * FROM lecture_sites WHERE id = ?').get(req.params.id);
    if (!site) return res.redirect('/admin/sites');
    res.render('admin/site-edit', { title: '사이트 정보 수정', site });
});

router.post('/sites/:id/edit', (req, res) => {
    const { slug, name, url, description } = req.body;
    const db = getDb();
    try {
        db.prepare('UPDATE lecture_sites SET slug = ?, name = ?, url = ?, description = ? WHERE id = ?')
            .run(slug, name, url, description, req.params.id);
    } catch (e) {
        // Handle error
    }
    res.redirect('/admin/sites');
});

export default router;
