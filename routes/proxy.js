import { Router } from 'express';
import { getDb } from '../lib/database.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

// ─── 강의 사이트 접근 (iframe 방식) ───
router.get('/site/:slug', requireLogin, (req, res) => {
    const db = getDb();
    const slug = req.params.slug;
    const user = req.session.user;

    // Find the lecture site
    const site = db.prepare('SELECT * FROM lecture_sites WHERE slug = ?').get(slug);
    if (!site) {
        return res.status(404).render('error', {
            title: '사이트 없음',
            message: '요청한 강의 사이트를 찾을 수 없습니다.',
            user
        });
    }

    // Super admin and Instructors always have access
    if (user.role === 'super_admin' || user.role === 'instructor') {
        return res.render('site-viewer', { title: site.name, site, user });
    }

    // Student: must have an approved enrollment in a course linked to this site
    if (user.role === 'student') {
        const enrollment = db.prepare(`
            SELECT e.id FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN course_sites cs ON c.id = cs.course_id
            WHERE e.student_id = ? AND cs.site_id = ? AND e.status = 'approved'
        `).get(user.id, site.id);

        if (enrollment) {
            return res.render('site-viewer', { title: site.name, site, user });
        }
    }

    return res.status(403).render('error', {
        title: '접근 거부',
        message: '이 강의 사이트에 접근할 권한이 없습니다. 수강 신청 후 승인을 받아주세요.',
        user
    });
});

export default router;
