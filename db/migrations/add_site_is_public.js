import sqlite3 from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../lms.db');

async function migrate() {
    const db = new sqlite3(dbPath);
    console.log('🔄 마이그레이션 시작: 강의 사이트 공개 여부(is_public) 컬럼 추가');

    try {
        // 컬럼이 이미 존재하는지 확인
        const cols = db.prepare("PRAGMA table_info(lecture_sites)").all();
        const exists = cols.some(c => c.name === 'is_public');

        if (exists) {
            console.log('ℹ️  is_public 컬럼이 이미 존재합니다. 스킵합니다.');
        } else {
            // is_public = 0: 내부 강의 사이트 (수강생 전용, 기본값)
            // is_public = 1: 외부 공개 참고 사이트 (로그인 사용자 누구나 접근)
            db.prepare('ALTER TABLE lecture_sites ADD COLUMN is_public INTEGER DEFAULT 0').run();
            console.log('✅ is_public 컬럼 추가 완료 (기본값: 0, 내부 강의 사이트)');
        }

        console.log('🎉 마이그레이션 완료!');
    } catch (err) {
        console.error('❌ 마이그레이션 실패:', err.message);
    } finally {
        db.close();
    }
}

migrate();
