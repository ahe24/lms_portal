import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../lib/database.js';

const router = Router();

// ─── 로그인 ───
router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('auth/login', { title: '로그인', error: null });
});

router.post('/login', async (req, res) => {
    const { login_id, password } = req.body;
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE login_id = ?').get(login_id);
    if (!user) {
        return res.render('auth/login', { title: '로그인', error: '존재하지 않는 ID입니다.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return res.render('auth/login', { title: '로그인', error: '비밀번호가 틀렸습니다.' });
    }

    // Instructor approval check
    if (user.role === 'instructor' && !user.is_approved) {
        return res.render('auth/login', { title: '로그인', error: '관리자 승인 대기 중입니다.' });
    }

    req.session.user = {
        id: user.id,
        login_id: user.login_id,
        name: user.name,
        role: user.role
    };

    // Redirect based on role
    switch (user.role) {
        case 'super_admin': return res.redirect('/admin');
        case 'instructor': return res.redirect('/instructor');
        case 'student': return res.redirect('/student');
        default: return res.redirect('/');
    }
});

// ─── 강사 회원가입 ───
router.get('/register/instructor', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('auth/register-instructor', { title: '강사 회원가입', error: null });
});

router.post('/register/instructor', async (req, res) => {
    const { login_id, password, password_confirm, name, affiliation } = req.body;
    const db = getDb();

    if (password !== password_confirm) {
        return res.render('auth/register-instructor', {
            title: '강사 회원가입', error: '비밀번호가 일치하지 않습니다.'
        });
    }

    const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(login_id);
    if (existing) {
        return res.render('auth/register-instructor', {
            title: '강사 회원가입', error: '이미 사용 중인 ID입니다.'
        });
    }

    const hash = await bcrypt.hash(password, 10);
    db.prepare(`
        INSERT INTO users (login_id, password_hash, name, role, affiliation, is_approved)
        VALUES (?, ?, ?, 'instructor', ?, 0)
    `).run(login_id, hash, name, affiliation);

    res.render('auth/login', {
        title: '로그인',
        error: null,
        success: '회원가입이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.'
    });
});

// ─── 수강생 회원가입 ───
router.get('/register/student', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('auth/register-student', { title: '수강생 회원가입', error: null });
});

router.post('/register/student', async (req, res) => {
    const { login_id, password, password_confirm, name, name_en, email, affiliation, phone, birth_date } = req.body;
    const db = getDb();

    if (password !== password_confirm) {
        return res.render('auth/register-student', {
            title: '수강생 회원가입', error: '비밀번호가 일치하지 않습니다.'
        });
    }

    const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(login_id);
    if (existing) {
        return res.render('auth/register-student', {
            title: '수강생 회원가입', error: '이미 사용 중인 ID입니다.'
        });
    }

    const hash = await bcrypt.hash(password, 10);
    db.prepare(`
        INSERT INTO users (login_id, password_hash, name, name_en, email, role, affiliation, phone, birth_date, is_approved)
        VALUES (?, ?, ?, ?, ?, 'student', ?, ?, ?, 1)
    `).run(login_id, hash, name, name_en, email, affiliation, phone, birth_date);

    res.render('auth/login', {
        title: '로그인',
        error: null,
        success: '회원가입이 완료되었습니다. 로그인해주세요.'
    });
});

// ─── 로그아웃 ───
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/auth/login');
    });
});

export default router;
