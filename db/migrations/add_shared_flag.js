import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'lms.db');

console.log('🔄 마이그레이션 시작: 공유 플래그 추가');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

try {
    // Add is_shared column to lecture_sites
    db.exec(`
        ALTER TABLE lecture_sites 
        ADD COLUMN is_shared INTEGER DEFAULT 0;
    `);
    console.log('✅ lecture_sites 테이블에 is_shared 컬럼 추가');

    // Add is_shared column to course_materials
    db.exec(`
        ALTER TABLE course_materials 
        ADD COLUMN is_shared INTEGER DEFAULT 0;
    `);
    console.log('✅ course_materials 테이블에 is_shared 컬럼 추가');

    console.log('🎉 마이그레이션 완료!');
} catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
    process.exit(1);
} finally {
    db.close();
}
