// Authentication & Authorization Middleware

export function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
}

export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        if (!roles.includes(req.session.user.role)) {
            return res.status(403).render('error', {
                title: '접근 거부',
                message: '이 페이지에 접근할 권한이 없습니다.',
                user: req.session.user
            });
        }
        next();
    };
}

// Make user available to all templates
export function injectUser(req, res, next) {
    res.locals.user = req.session.user || null;
    next();
}
