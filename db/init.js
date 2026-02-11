import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'lms.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Delete existing DB for fresh start
if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('🗑️  기존 DB 삭제');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Execute schema
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);
console.log('✅ 테이블 생성 완료');

// Seed Super Admin
const adminPassword = await bcrypt.hash('ednc70998!', 10);
db.prepare(`
    INSERT INTO users (login_id, password_hash, name, role, is_approved)
    VALUES (?, ?, ?, 'super_admin', 1)
`).run('admin', adminPassword, '관리자');
console.log('✅ Super Admin 계정 생성: admin / ednc70998!');

// Seed default lecture site (linux_lect)
db.prepare(`
    INSERT INTO lecture_sites (slug, name, url, description)
    VALUES (?, ?, ?, ?)
`).run(
    'linux-lect',
    'FPGA 엔지니어를 위한 Linux 개발환경',
    'http://localhost:5173',
    'Linux 서버 구축, 시뮬레이션 환경 설정, VIM 마스터리, Shell 자동화 가이드'
);
console.log('✅ 강의 사이트 등록: linux-lect');

db.close();
console.log('\n🎉 DB 초기화 완료! (db/lms.db)');
