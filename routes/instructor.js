import { Router } from 'express';
import { getDb } from '../lib/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('instructor'));

// ─── 대시보드 ───
router.get('/', (req, res) => {
    const db = getDb();
    const courses = db.prepare(`
        SELECT c.*,
            (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'pending') as pending_count,
            (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'approved') as approved_count
        FROM courses c
        WHERE c.instructor_id = ?
        ORDER BY c.created_at DESC
    `).all(req.session.user.id);

    // Attach linked sites to each course
    const siteStmt = db.prepare(`
        SELECT ls.id, ls.slug, ls.name FROM course_sites cs
        JOIN lecture_sites ls ON cs.site_id = ls.id
        WHERE cs.course_id = ?
    `);
    // Attach linked materials
    const matStmt = db.prepare(`
        SELECT cm.id, cm.title FROM course_material_links cml
        JOIN course_materials cm ON cml.material_id = cm.id
        WHERE cml.course_id = ?
    `);

    courses.forEach(c => {
        c.sites = siteStmt.all(c.id);
        c.materials = matStmt.all(c.id);
    });

    res.render('instructor/dashboard', { title: '강사 대시보드', courses });
});

// ─── 강의 개설 ───
router.get('/courses/new', (req, res) => {
    const db = getDb();
    const sites = db.prepare('SELECT * FROM lecture_sites ORDER BY name').all();
    const materials = db.prepare('SELECT id, title FROM course_materials WHERE creator_id = ? ORDER BY title').all(req.session.user.id);
    res.render('instructor/course-new', { title: '강의 개설', sites, materials, error: null });
});

router.post('/courses', (req, res) => {
    const { title, description } = req.body;
    const db = getDb();

    let siteIds = req.body.site_ids || [];
    if (!Array.isArray(siteIds)) siteIds = [siteIds];

    let materialIds = req.body.material_ids || [];
    if (!Array.isArray(materialIds)) materialIds = [materialIds];

    const result = db.prepare(`
        INSERT INTO courses (title, description, instructor_id)
        VALUES (?, ?, ?)
    `).run(title, description, req.session.user.id);

    const courseId = result.lastInsertRowid;

    const insertSite = db.prepare('INSERT INTO course_sites (course_id, site_id) VALUES (?, ?)');
    siteIds.filter(id => id).forEach(id => insertSite.run(courseId, id));

    const insertMat = db.prepare('INSERT INTO course_material_links (course_id, material_id) VALUES (?, ?)');
    materialIds.filter(id => id).forEach(id => insertMat.run(courseId, id));

    res.redirect('/instructor');
});

// ─── 강의 수정 ───
router.get('/courses/:id/edit', (req, res) => {
    const db = getDb();
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
        .get(req.params.id, req.session.user.id);
    if (!course) return res.redirect('/instructor');

    const sites = db.prepare('SELECT * FROM lecture_sites ORDER BY name').all();
    const materials = db.prepare('SELECT id, title FROM course_materials WHERE creator_id = ? ORDER BY title').all(req.session.user.id);

    const linkedSiteIds = db.prepare('SELECT site_id FROM course_sites WHERE course_id = ?')
        .all(course.id).map(r => r.site_id);
    const linkedMaterialIds = db.prepare('SELECT material_id FROM course_material_links WHERE course_id = ?')
        .all(course.id).map(r => r.material_id);

    res.render('instructor/course-edit', {
        title: '강의 수정', course, sites, materials, linkedSiteIds, linkedMaterialIds, error: null
    });
});

router.post('/courses/:id/edit', (req, res) => {
    const { title, description } = req.body;
    const db = getDb();

    let siteIds = req.body.site_ids || [];
    if (!Array.isArray(siteIds)) siteIds = [siteIds];

    let materialIds = req.body.material_ids || [];
    if (!Array.isArray(materialIds)) materialIds = [materialIds];

    db.prepare(`
        UPDATE courses SET title = ?, description = ?
        WHERE id = ? AND instructor_id = ?
    `).run(title, description, req.params.id, req.session.user.id);

    // Replace linked sites
    db.prepare('DELETE FROM course_sites WHERE course_id = ?').run(req.params.id);
    const insertSite = db.prepare('INSERT INTO course_sites (course_id, site_id) VALUES (?, ?)');
    siteIds.filter(id => id).forEach(id => insertSite.run(req.params.id, id));

    // Replace linked materials
    db.prepare('DELETE FROM course_material_links WHERE course_id = ?').run(req.params.id);
    const insertMat = db.prepare('INSERT INTO course_material_links (course_id, material_id) VALUES (?, ?)');
    materialIds.filter(id => id).forEach(id => insertMat.run(req.params.id, id));

    res.redirect('/instructor');
});

// ─── 수강생 관리 (특정 강의) ───
const STUDENT_QUERY = `
    SELECT e.*, u.login_id, u.name, u.name_en, u.email, u.affiliation, u.phone, u.birth_date
    FROM enrollments e
    JOIN users u ON e.student_id = u.id
    WHERE e.course_id = ?
    ORDER BY e.status ASC, e.created_at DESC
`;

router.get('/courses/:id/students', (req, res) => {
    const db = getDb();
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
        .get(req.params.id, req.session.user.id);

    if (!course) return res.redirect('/instructor');

    const enrollments = db.prepare(STUDENT_QUERY).all(req.params.id);

    res.render('instructor/students', { title: '수강생 관리', course, enrollments });
});

// ─── 수강생 목록 Excel(CSV) 내보내기 ───
router.get('/courses/:id/export', (req, res) => {
    const db = getDb();
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
        .get(req.params.id, req.session.user.id);

    if (!course) return res.redirect('/instructor');

    const enrollments = db.prepare(STUDENT_QUERY).all(req.params.id);
    const approved = enrollments.filter(e => e.status === 'approved');

    const BOM = '\uFEFF';
    const header = ['ID', '이름', '영문이름', '소속', '이메일', '전화번호', '생년월일', '수강신청일'];
    const rows = approved.map(e => [
        e.login_id, e.name, e.name_en || '', e.affiliation || '', e.email || '', e.phone || '', e.birth_date || '', e.created_at || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = BOM + [header.join(','), ...rows].join('\r\n');
    const filename = encodeURIComponent(`${course.title}_수강생목록.csv`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(csv);
});

router.post('/enrollments/:id/approve', (req, res) => {
    const db = getDb();
    const enrollment = db.prepare(`
        SELECT e.course_id FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE e.id = ? AND c.instructor_id = ?
    `).get(req.params.id, req.session.user.id);

    if (enrollment) {
        db.prepare("UPDATE enrollments SET status = 'approved' WHERE id = ?").run(req.params.id);
        return res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
    }
    res.redirect('/instructor');
});

router.post('/enrollments/:id/reject', (req, res) => {
    const db = getDb();
    const enrollment = db.prepare(`
        SELECT e.course_id FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE e.id = ? AND c.instructor_id = ?
    `).get(req.params.id, req.session.user.id);

    if (enrollment) {
        db.prepare("UPDATE enrollments SET status = 'rejected' WHERE id = ?").run(req.params.id);
        return res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
    }
    res.redirect('/instructor');
});

// ─── 강의 삭제 ───
router.post('/courses/:id/delete', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM course_sites WHERE course_id = ?').run(req.params.id);
    db.prepare('DELETE FROM course_material_links WHERE course_id = ?').run(req.params.id);
    db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(req.params.id);
    db.prepare('DELETE FROM courses WHERE id = ? AND instructor_id = ?').run(req.params.id, req.session.user.id);
    res.redirect('/instructor');
});

// ─── 강의 사이트 관리 ───
router.get('/sites', (req, res) => {
    const db = getDb();
    const sites = db.prepare('SELECT * FROM lecture_sites ORDER BY created_at DESC').all();
    res.render('instructor/sites', { title: '강의 사이트 관리', sites, user: req.session.user });
});

router.post('/sites', (req, res) => {
    const { slug, name, url, description } = req.body;
    const db = getDb();
    try {
        db.prepare('INSERT INTO lecture_sites (slug, name, url, description, creator_id) VALUES (?, ?, ?, ?, ?)')
            .run(slug, name, url, description, req.session.user.id);
    } catch (e) { }
    res.redirect('/instructor/sites');
});

router.post('/sites/:id/delete', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM lecture_sites WHERE id = ? AND creator_id = ?').run(req.params.id, req.session.user.id);
    res.redirect('/instructor/sites');
});

// ─── 강의 사이트 수정 ───
router.get('/sites/:id/edit', (req, res) => {
    const db = getDb();
    const site = db.prepare('SELECT * FROM lecture_sites WHERE id = ? AND creator_id = ?').get(req.params.id, req.session.user.id);
    if (!site) return res.redirect('/instructor/sites');
    res.render('instructor/site-edit', { title: '사이트 정보 수정', site });
});

router.post('/sites/:id/edit', (req, res) => {
    const { slug, name, url, description } = req.body;
    const db = getDb();
    try {
        db.prepare('UPDATE lecture_sites SET slug = ?, name = ?, url = ?, description = ? WHERE id = ? AND creator_id = ?')
            .run(slug, name, url, description, req.params.id, req.session.user.id);
    } catch (e) {
        // Handle error (e.g., slug duplicate)
    }
    res.redirect('/instructor/sites');
});

export default router;
