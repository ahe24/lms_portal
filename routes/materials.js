import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/database.js';
import { requireLogin, requireRole } from '../middleware/auth.js';
import { convertPdfToImages, getPageImagePath, deleteMaterialImages } from '../lib/pdf-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

// Multer config: accept only PDF, max 50MB
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads', 'temp'),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('PDF 파일만 업로드 가능합니다.'));
        }
    }
});

// ─── 자료 보관함 (강사 전체 라이브러리) ───
router.get('/instructor/materials', requireRole('instructor'), (req, res) => {
    const db = getDb();
    const materials = db.prepare('SELECT * FROM course_materials WHERE creator_id = ? ORDER BY uploaded_at DESC')
        .all(req.session.user.id);

    res.render('instructor/materials', { title: '자료 보관함', materials, error: null });
});

// ─── PDF 업로드 + 변환 (보관함에 저장) ───
router.post('/instructor/materials/upload', requireRole('instructor'), upload.single('pdf'), async (req, res) => {
    const db = getDb();
    if (!req.file) return res.redirect('/instructor/materials');

    const title = req.body.title || req.file.originalname.replace('.pdf', '');
    const socketId = req.body.socket_id;

    try {
        const result = db.prepare(
            'INSERT INTO course_materials (creator_id, title, original_name) VALUES (?, ?, ?)'
        ).run(req.session.user.id, title, req.file.originalname);

        const materialId = result.lastInsertRowid;

        // Progress callback using socket.io
        const onProgress = (current, total) => {
            if (socketId && req.io) {
                req.io.to(socketId).emit('pdf-progress', {
                    current,
                    total,
                    percent: Math.round((current / total) * 100)
                });
            }
        };

        const pageCount = await convertPdfToImages(req.file.path, materialId, onProgress);

        db.prepare('UPDATE course_materials SET page_count = ? WHERE id = ?').run(pageCount, materialId);
        fs.unlinkSync(req.file.path);

        res.redirect('/instructor/materials');
    } catch (err) {
        console.error('PDF 변환 오류:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        const materials = db.prepare('SELECT * FROM course_materials WHERE creator_id = ? ORDER BY uploaded_at DESC')
            .all(req.session.user.id);
        res.render('instructor/materials', {
            title: '자료 보관함', materials,
            error: 'PDF 변환 중 오류가 발생했습니다: ' + err.message
        });
    }
});

// ─── 자료 삭제 (보관함에서 제거) ───
router.post('/instructor/materials/:id/delete', requireRole('instructor'), (req, res) => {
    const db = getDb();
    const material = db.prepare('SELECT id FROM course_materials WHERE id = ? AND creator_id = ?')
        .get(req.params.id, req.session.user.id);

    if (material) {
        deleteMaterialImages(material.id);
        db.prepare('DELETE FROM course_materials WHERE id = ?').run(material.id);
    }
    res.redirect('/instructor/materials');
});

/**
 * 전용 권한 체크 유틸리티
 */
function checkMaterialAccess(db, user, materialId) {
    const material = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(materialId);
    if (!material) return { material: null, hasAccess: false };

    // Allow super_admin or ANY instructor to view materials
    if (user.role === 'super_admin' || user.role === 'instructor') {
        return { material, hasAccess: true };
    }

    if (user.role === 'student') {
        // 학생은 이 자료가 연결된 강의 중 자신이 승인된 수강생인 강의가 하나라도 있는지 확인
        const access = db.prepare(`
            SELECT cml.id FROM course_material_links cml
            JOIN enrollments e ON cml.course_id = e.course_id
            WHERE cml.material_id = ? AND e.student_id = ? AND e.status = 'approved'
        `).get(materialId, user.id);
        if (access) return { material, hasAccess: true };
    }

    return { material, hasAccess: false };
}

// ─── 슬라이드 뷰어 ───
router.get('/materials/:id/view', requireLogin, (req, res) => {
    const db = getDb();
    const { material, hasAccess } = checkMaterialAccess(db, req.session.user, req.params.id);

    if (!material) {
        return res.status(404).render('error', { title: '자료 없음', message: '요청한 강의 자료를 찾을 수 없습니다.', user: req.session.user });
    }
    if (!hasAccess) {
        return res.status(403).render('error', { title: '접근 거부', message: '이 자료에 접근할 권한이 없습니다.', user: req.session.user });
    }

    res.render('materials/viewer', { title: material.title, material, user: req.session.user });
});

// ─── 개별 페이지 이미지 (보호됨) ───
router.get('/materials/:id/page/:num', requireLogin, (req, res) => {
    const db = getDb();
    const { material, hasAccess } = checkMaterialAccess(db, req.session.user, req.params.id);

    if (!material || !hasAccess) return res.status(403).end();

    const pageNum = parseInt(req.params.num);
    const imagePath = getPageImagePath(material.id, pageNum);
    if (!imagePath) return res.status(404).end();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(imagePath).pipe(res);
});

export default router;
