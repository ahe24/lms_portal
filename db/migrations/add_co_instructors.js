import sqlite3 from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../lms.db');

async function migrate() {
    const db = new sqlite3(dbPath);
    console.log('🔄 마이그레이션 시작: 공동 강사 기능 추가');

    try {
        // 1. 공동 강사 매핑 테이블 생성
        db.prepare(`
            CREATE TABLE IF NOT EXISTS course_instructors (
                course_id INTEGER NOT NULL,
                instructor_id INTEGER NOT NULL,
                added_at TEXT DEFAULT (datetime('now', 'localtime')),
                PRIMARY KEY (course_id, instructor_id),
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `).run();
        console.log('✅ course_instructors 테이블 생성 완료');

        // 2. 기존 데이터 마이그레이션 (기본 강사를 공동 강사 테이블에도 추가)
        const courses = db.prepare('SELECT id, instructor_id FROM courses').all();
        const insertCo = db.prepare('INSERT OR IGNORE INTO course_instructors (course_id, instructor_id) VALUES (?, ?)');

        let count = 0;
        for (const course of courses) {
            insertCo.run(course.id, course.instructor_id);
            count++;
        }
        console.log(`✅ 기존 ${count}개 강의의 주 강사를 공동 강사 목록에 등록 완료`);

        console.log('🎉 마이그레이션 완료!');
    } catch (err) {
        console.error('❌ 마이그레이션 실패:', err.message);
    } finally {
        db.close();
    }
}

migrate();
