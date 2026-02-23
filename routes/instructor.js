import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../lib/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('instructor'));

// ─── 프로필 관리 ───
router.get('/profile', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    res.render('instructor/profile', {
        title: '내 정보 수정',
        user,
        error: null,
        success: null,
        type: null
    });
});

router.post('/profile', (req, res) => {
    const { name, name_en, email, affiliation, phone } = req.body;
    const db = getDb();

    try {
        db.prepare(`
            UPDATE users 
            SET name = ?, name_en = ?, email = ?, affiliation = ?, phone = ?
            WHERE id = ?
        `).run(name, name_en, email, affiliation, phone, req.session.user.id);

        // Update session info
        req.session.user.name = name;
        req.session.user.email = email;

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
        res.render('instructor/profile', {
            title: '내 정보 수정',
            user,
            error: null,
            success: '정보가 수정되었습니다.',
            type: 'info'
        });
    } catch (err) {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
        res.render('instructor/profile', {
            title: '내 정보 수정',
            user,
            error: '정보 수정 중 오류가 발생했습니다: ' + err.message,
            success: null,
            type: 'info'
        });
    }
});

router.post('/profile/password', async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

    if (new_password !== confirm_password) {
        return res.render('instructor/profile', {
            title: '내 정보 수정',
            user,
            error: '새 비밀번호가 일치하지 않습니다.',
            success: null,
            type: 'password'
        });
    }

    const match = await bcrypt.compare(current_password, user.password);
    if (!match) {
        return res.render('instructor/profile', {
            title: '내 정보 수정',
            user,
            error: '현재 비밀번호가 일치하지 않습니다.',
            success: null,
            type: 'password'
        });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

    res.render('instructor/profile', {
        title: '내 정보 수정',
        user,
        error: null,
        success: '비밀번호가 변경되었습니다.',
        type: 'password'
    });
});

// ─── 대시보드 ───
router.get('/', (req, res) => {
    const db = getDb();
    const courses = db.prepare(`
        SELECT c.*, u.name as instructor_name,
            (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'pending') as pending_count,
            (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'approved') as approved_count
        FROM courses c
        JOIN users u ON c.instructor_id = u.id
        LEFT JOIN course_instructors ci ON c.id = ci.course_id
        WHERE c.instructor_id = ? OR ci.instructor_id = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all(req.session.user.id, req.session.user.id);

    // Attach linked sites to each course
    const siteStmt = db.prepare(`
        SELECT ls.id, ls.slug, ls.name, ls.url, ls.is_public FROM course_sites cs
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

    // Fetch courses created by other instructors
    const otherCourses = db.prepare(`
        SELECT c.*, u.name as instructor_name,
            (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'approved') as approved_count
        FROM courses c
        JOIN users u ON c.instructor_id = u.id
        WHERE c.instructor_id != ?
        ORDER BY c.created_at DESC
    `).all(req.session.user.id);

    // Attach linked sites and materials to other courses as well
    otherCourses.forEach(c => {
        c.sites = siteStmt.all(c.id);
        c.materials = matStmt.all(c.id);
    });

    res.render('instructor/dashboard', { title: '강사 대시보드', courses, otherCourses });
});

// ─── 강의 개설 ───
router.get('/courses/new', (req, res) => {
    const db = getDb();

    // Get all sites (including shared ones from other instructors) with creator info
    const sites = db.prepare(`
        SELECT ls.*, u.name as creator_name, u.login_id as creator_login
        FROM lecture_sites ls
        LEFT JOIN users u ON ls.creator_id = u.id
        WHERE ls.creator_id = ? OR ls.is_shared = 1 
        ORDER BY ls.name
    `).all(req.session.user.id);

    // Get materials (own + shared from other instructors) with creator info
    const materials = db.prepare(`
        SELECT cm.id, cm.title, cm.creator_id, u.name as creator_name, u.login_id as creator_login
        FROM course_materials cm
        LEFT JOIN users u ON cm.creator_id = u.id
        WHERE cm.creator_id = ? OR cm.is_shared = 1 
        ORDER BY cm.title
    `).all(req.session.user.id);

    // Get all instructors except yourself
    const instructors = db.prepare("SELECT id, name, login_id FROM users WHERE role = 'instructor' AND id != ? ORDER BY name")
        .all(req.session.user.id);

    res.render('instructor/course-new', {
        title: '강의 개설',
        sites,
        materials,
        instructors,
        user: req.session.user,
        error: null
    });
});

router.post('/courses', (req, res) => {
    const { title, description } = req.body;
    const db = getDb();

    let siteIds = req.body.site_ids || [];
    if (!Array.isArray(siteIds)) siteIds = [siteIds];

    let materialIds = req.body.material_ids || [];
    if (!Array.isArray(materialIds)) materialIds = [materialIds];

    let coInstructorIds = req.body.instructor_ids || [];
    if (!Array.isArray(coInstructorIds)) coInstructorIds = [coInstructorIds];

    const result = db.prepare(`
        INSERT INTO courses (title, description, instructor_id)
        VALUES (?, ?, ?)
    `).run(title, description, req.session.user.id);

    const courseId = result.lastInsertRowid;

    // Save sites
    const insertSite = db.prepare('INSERT INTO course_sites (course_id, site_id) VALUES (?, ?)');
    siteIds.filter(id => id).forEach(id => insertSite.run(courseId, id));

    // Save materials
    const insertMat = db.prepare('INSERT INTO course_material_links (course_id, material_id) VALUES (?, ?)');
    materialIds.filter(id => id).forEach(id => insertMat.run(courseId, id));

    // Save co-instructors (including creator)
    const insertCo = db.prepare('INSERT OR IGNORE INTO course_instructors (course_id, instructor_id) VALUES (?, ?)');
    insertCo.run(courseId, req.session.user.id); // Add creator
    coInstructorIds.filter(id => id).forEach(id => insertCo.run(courseId, id));

    res.redirect('/instructor');
});

// ─── 강의 수정 ───
router.get('/courses/:id/edit', (req, res) => {
    const db = getDb();
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
        .get(req.params.id, req.session.user.id);
    if (!course) return res.redirect('/instructor');

    // Get all sites (including shared ones from other instructors) with creator info
    const sites = db.prepare(`
        SELECT ls.*, u.name as creator_name, u.login_id as creator_login
        FROM lecture_sites ls
        LEFT JOIN users u ON ls.creator_id = u.id
        WHERE ls.creator_id = ? OR ls.is_shared = 1 
        ORDER BY ls.name
    `).all(req.session.user.id);

    // Get materials (own + shared from other instructors) with creator info
    const materials = db.prepare(`
        SELECT cm.id, cm.title, cm.creator_id, u.name as creator_name, u.login_id as creator_login
        FROM course_materials cm
        LEFT JOIN users u ON cm.creator_id = u.id
        WHERE cm.creator_id = ? OR cm.is_shared = 1 
        ORDER BY cm.title
    `).all(req.session.user.id);

    const linkedSiteIds = db.prepare('SELECT site_id FROM course_sites WHERE course_id = ?')
        .all(course.id).map(r => r.site_id);
    const linkedMaterialIds = db.prepare('SELECT material_id FROM course_material_links WHERE course_id = ?')
        .all(course.id).map(r => r.material_id);
    const linkedInstructorIds = db.prepare('SELECT instructor_id FROM course_instructors WHERE course_id = ?')
        .all(course.id).map(r => r.instructor_id);

    // Get all instructors except yourself
    const instructors = db.prepare("SELECT id, name, login_id FROM users WHERE role = 'instructor' AND id != ? ORDER BY name")
        .all(req.session.user.id);

    res.render('instructor/course-edit', {
        title: '강의 수정',
        course,
        sites,
        materials,
        instructors,
        linkedSiteIds,
        linkedMaterialIds,
        linkedInstructorIds,
        user: req.session.user,
        error: null
    });
});

router.post('/courses/:id/edit', (req, res) => {
    const { title, description } = req.body;
    const db = getDb();
    const courseId = req.params.id;
    const userId = req.session.user.id;

    // Check permission: Is primary instructor OR co-instructor?
    const hasPermission = db.prepare(`
        SELECT 1 FROM courses WHERE id = ? AND instructor_id = ?
        UNION
        SELECT 1 FROM course_instructors WHERE course_id = ? AND instructor_id = ?
    `).get(courseId, userId, courseId, userId);

    if (!hasPermission) {
        return res.status(403).send('권한이 없습니다.');
    }

    let siteIds = req.body.site_ids || [];
    if (!Array.isArray(siteIds)) siteIds = [siteIds];

    let materialIds = req.body.material_ids || [];
    if (!Array.isArray(materialIds)) materialIds = [materialIds];

    let coInstructorIds = req.body.instructor_ids || [];
    if (!Array.isArray(coInstructorIds)) coInstructorIds = [coInstructorIds];

    // Update basic info
    db.prepare(`
        UPDATE courses SET title = ?, description = ?
        WHERE id = ?
    `).run(title, description, courseId);

    // Replace linked sites
    db.prepare('DELETE FROM course_sites WHERE course_id = ?').run(courseId);
    const insertSite = db.prepare('INSERT INTO course_sites (course_id, site_id) VALUES (?, ?)');
    siteIds.filter(id => id).forEach(id => insertSite.run(courseId, id));

    // Replace linked materials
    db.prepare('DELETE FROM course_material_links WHERE course_id = ?').run(courseId);
    const insertMat = db.prepare('INSERT INTO course_material_links (course_id, material_id) VALUES (?, ?)');
    materialIds.filter(id => id).forEach(id => insertMat.run(courseId, id));

    // Replace co-instructors
    // Get the primary creator for this course (so we don't remove them)
    const primary = db.prepare('SELECT instructor_id FROM courses WHERE id = ?').get(courseId);

    db.prepare('DELETE FROM course_instructors WHERE course_id = ?').run(courseId);
    const insertCo = db.prepare('INSERT OR IGNORE INTO course_instructors (course_id, instructor_id) VALUES (?, ?)');

    // Ensure primary creator is always in co-instructors
    if (primary) insertCo.run(courseId, primary.instructor_id);

    // Add selected ones
    coInstructorIds.filter(id => id).forEach(id => insertCo.run(courseId, id));

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
    const courseId = req.params.id;
    const userId = req.session.user.id;

    // Permission check: primary OR co-instructor
    const course = db.prepare(`
        SELECT c.* FROM courses c
        LEFT JOIN course_instructors ci ON c.id = ci.course_id
        WHERE c.id = ? AND (c.instructor_id = ? OR ci.instructor_id = ?)
    `).get(courseId, userId, userId);

    if (!course) return res.redirect('/instructor');

    const enrollments = db.prepare(STUDENT_QUERY).all(courseId);
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

// 권한 체크 헬퍼: enrollment id → 해당 강의에 대한 접근 권한 있는지 확인
function getEnrollmentWithPermission(db, enrollmentId, instructorId) {
    return db.prepare(`
        SELECT e.id, e.course_id, e.student_id FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        LEFT JOIN course_instructors ci ON c.id = ci.course_id
        WHERE e.id = ? AND (c.instructor_id = ? OR ci.instructor_id = ?)
    `).get(enrollmentId, instructorId, instructorId);
}

router.post('/enrollments/:id/approve', (req, res) => {
    const db = getDb();
    const enrollment = getEnrollmentWithPermission(db, req.params.id, req.session.user.id);
    if (enrollment) {
        db.prepare("UPDATE enrollments SET status = 'approved' WHERE id = ?").run(req.params.id);
        return res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
    }
    res.redirect('/instructor');
});

router.post('/enrollments/:id/reject', (req, res) => {
    const db = getDb();
    const enrollment = getEnrollmentWithPermission(db, req.params.id, req.session.user.id);
    if (enrollment) {
        db.prepare("UPDATE enrollments SET status = 'rejected' WHERE id = ?").run(req.params.id);
        return res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
    }
    res.redirect('/instructor');
});

// ─── 수강생 정보 수정 ───
router.get('/enrollments/:id/edit-student', (req, res) => {
    const db = getDb();
    const enrollment = getEnrollmentWithPermission(db, req.params.id, req.session.user.id);
    if (!enrollment) return res.redirect('/instructor');

    const student = db.prepare('SELECT * FROM users WHERE id = ?').get(enrollment.student_id);
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(enrollment.course_id);
    res.render('instructor/student-edit', {
        title: '수강생 정보 수정',
        student,
        course,
        enrollmentId: req.params.id,
        error: null,
        success: null
    });
});

router.post('/enrollments/:id/edit-student', (req, res) => {
    const db = getDb();
    const enrollment = getEnrollmentWithPermission(db, req.params.id, req.session.user.id);
    if (!enrollment) return res.redirect('/instructor');

    const { name, name_en, email, affiliation, phone, birth_date } = req.body;
    try {
        db.prepare(`
            UPDATE users SET name = ?, name_en = ?, email = ?, affiliation = ?, phone = ?, birth_date = ?
            WHERE id = ?
        `).run(name, name_en, email, affiliation, phone, birth_date, enrollment.student_id);
        return res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
    } catch (err) {
        const student = db.prepare('SELECT * FROM users WHERE id = ?').get(enrollment.student_id);
        const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(enrollment.course_id);
        res.render('instructor/student-edit', {
            title: '수강생 정보 수정',
            student,
            course,
            enrollmentId: req.params.id,
            error: '정보 수정 중 오류가 발생했습니다: ' + err.message,
            success: null
        });
    }
});

// ─── 수강생 삭제 (수강 등록 취소) ───
router.post('/enrollments/:id/delete', (req, res) => {
    const db = getDb();
    const enrollment = getEnrollmentWithPermission(db, req.params.id, req.session.user.id);
    if (!enrollment) return res.redirect('/instructor');

    db.prepare('DELETE FROM enrollments WHERE id = ?').run(req.params.id);
    res.redirect(`/instructor/courses/${enrollment.course_id}/students`);
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

    // Get own sites
    const mySites = db.prepare('SELECT * FROM lecture_sites WHERE creator_id = ? ORDER BY created_at DESC')
        .all(req.session.user.id);

    // Get shared sites from other instructors with creator info
    const sharedSites = db.prepare(`
        SELECT ls.*, u.name as creator_name, u.login_id as creator_login
        FROM lecture_sites ls
        JOIN users u ON ls.creator_id = u.id
        WHERE ls.creator_id != ? AND ls.is_shared = 1
        ORDER BY ls.created_at DESC
    `).all(req.session.user.id);

    res.render('instructor/sites', {
        title: '강의 사이트 관리',
        mySites,
        sharedSites,
        user: req.session.user
    });
});

router.post('/sites', (req, res) => {
    const { name, url, description, is_shared, is_public } = req.body;
    const db = getDb();
    // 슬러그 자동 생성: 이름에서 영문/숫자만 추출 후 타임스탬프 추가
    const autoSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    try {
        db.prepare('INSERT INTO lecture_sites (slug, name, url, description, creator_id, is_shared, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(autoSlug, name, url, description, req.session.user.id, is_shared ? 1 : 0, is_public ? 1 : 0);
    } catch (e) { }
    res.redirect('/instructor/sites');
});

router.post('/sites/:id/delete', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM lecture_sites WHERE id = ? AND creator_id = ?').run(req.params.id, req.session.user.id);
    res.redirect('/instructor/sites');
});

// Toggle share status
router.post('/sites/:id/toggle-share', (req, res) => {
    const db = getDb();
    const site = db.prepare('SELECT is_shared FROM lecture_sites WHERE id = ? AND creator_id = ?')
        .get(req.params.id, req.session.user.id);

    if (site) {
        const newStatus = site.is_shared ? 0 : 1;
        db.prepare('UPDATE lecture_sites SET is_shared = ? WHERE id = ?')
            .run(newStatus, req.params.id);
    }
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
    const { name, url, description, is_public } = req.body;
    const db = getDb();
    try {
        db.prepare('UPDATE lecture_sites SET name = ?, url = ?, description = ?, is_public = ? WHERE id = ? AND creator_id = ?')
            .run(name, url, description, is_public ? 1 : 0, req.params.id, req.session.user.id);
    } catch (e) {
        // Handle error
    }
    res.redirect('/instructor/sites');
});

export default router;
