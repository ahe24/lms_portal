import { Router } from 'express';
import { getDb } from '../lib/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('student'));

// ─── 대시보드 ───
router.get('/', (req, res) => {
    const db = getDb();

    // 내 수강 목록
    const myEnrollments = db.prepare(`
        SELECT e.*, c.title as course_title, c.description as course_desc,
            u.name as instructor_name
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN users u ON c.instructor_id = u.id
        WHERE e.student_id = ?
        ORDER BY e.created_at DESC
    `).all(req.session.user.id);

    // Attach linked sites and materials to each enrollment
    const siteStmt = db.prepare(`
        SELECT ls.slug, ls.name FROM course_sites cs
        JOIN lecture_sites ls ON cs.site_id = ls.id
        WHERE cs.course_id = ?
    `);
    const matStmt = db.prepare(`
        SELECT cm.id, cm.title, cm.page_count FROM course_material_links cml
        JOIN course_materials cm ON cml.material_id = cm.id
        WHERE cml.course_id = ?
        ORDER BY cm.uploaded_at
    `);
    myEnrollments.forEach(e => {
        e.sites = siteStmt.all(e.course_id);
        e.materials = matStmt.all(e.course_id);
    });

    // 수강 신청 가능한 강의 (아직 신청 안 한 활성 강의)
    const availableCourses = db.prepare(`
        SELECT c.*, u.name as instructor_name
        FROM courses c
        JOIN users u ON c.instructor_id = u.id
        WHERE c.status = 'active'
        AND c.id NOT IN (SELECT course_id FROM enrollments WHERE student_id = ?)
        ORDER BY c.created_at DESC
    `).all(req.session.user.id);

    availableCourses.forEach(c => {
        c.sites = siteStmt.all(c.id);
        c.materials = matStmt.all(c.id);
    });

    res.render('student/dashboard', { title: '수강생 대시보드', myEnrollments, availableCourses });
});

// ─── 수강 신청 ───
router.post('/enroll/:courseId', (req, res) => {
    const db = getDb();
    const course = db.prepare("SELECT id FROM courses WHERE id = ? AND status = 'active'").get(req.params.courseId);

    if (course) {
        try {
            db.prepare(`
                INSERT INTO enrollments (course_id, student_id, status)
                VALUES (?, ?, 'pending')
            `).run(req.params.courseId, req.session.user.id);
        } catch (e) {
            // Already enrolled - ignore duplicate
        }
    }
    res.redirect('/student');
});

// ─── 수강 취소 ───
router.post('/unenroll/:enrollmentId', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM enrollments WHERE id = ? AND student_id = ?')
        .run(req.params.enrollmentId, req.session.user.id);
    res.redirect('/student');
});

// ─── 내 정보 수정 ───
router.get('/profile', (req, res) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    res.render('student/profile', { title: '내 정보 수정', profile, error: null, success: null });
});

router.post('/profile', (req, res) => {
    const { name, name_en, email, affiliation, phone, birth_date } = req.body;
    const db = getDb();

    db.prepare(`
        UPDATE users SET name = ?, name_en = ?, email = ?, affiliation = ?, phone = ?, birth_date = ?
        WHERE id = ?
    `).run(name, name_en, email, affiliation, phone, birth_date, req.session.user.id);

    // Update session data
    req.session.user.name = name;

    res.render('student/profile', {
        title: '내 정보 수정',
        profile: { ...req.session.user, name, name_en, email, affiliation, phone, birth_date },
        error: null,
        success: '정보가 수정되었습니다.'
    });
});

export default router;
