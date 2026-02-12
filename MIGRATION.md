# LMS Portal Server Migration Guide (Rocky Linux 9)

This guide details the steps to deploy the LMS Portal application to a Rocky Linux 9 server using PM2.

## Prerequisites

- **Rocky Linux 9 Server** prepared.
- **Node.js** (LTS version recommended, e.g., v18 or v20) installed.
- **PM2** installed globally (`npm install -g pm2`).
- **Git** installed.

## Installation Steps

1.  **Clone the Repository**
    Navigate to your desired deployment directory and clone the repository:
    ```bash
    git clone https://github.com/ahe24/lms_portal.git
    cd lms_portal
    ```

2.  **Install Dependencies**
    Install the required Node.js packages:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**
    Create a `.env` file from the template:
    ```bash
    cp .env.template .env
    ```
    Edit `.env` and set your specific configuration (especially `HOST` and `PORT`):
    ```bash
    vi .env
    ```
    *Example `.env` content:*
    ```env
    HOST=0.0.0.0
    PORT=3000
    SESSION_SECRET=your-secure-secret-key
    ```
    > **Note:** The `ecosystem.config.cjs` file deliberately does not contain network settings. The application will read `HOST` and `PORT` directly from this `.env` file.

4.  **Initialize Database**
    Run the database initialization script to set up SQLite tables:
    ```bash
    npm run db:init
    ```

5.  **Start with PM2**
    Register and start the application using the ecosystem file:
    ```bash
    pm2 start ecosystem.config.cjs
    ```

6.  **Save PM2 Process List**
    Ensure the application restarts on server reboot:
    ```bash
    pm2 save
    pm2 startup
    ```
    (Follow the command output from `pm2 startup` if prompted).

## Maintenance

- **View Logs:**
  ```bash
  pm2 logs lms_portal
  ```
- **Restart Application:**
  ```bash
  pm2 restart lms_portal
  ```
- **Stop Application:**
  ```bash
  pm2 stop lms_portal
  ```

## Database Migrations (for Updates)

If you are updating an existing installation rather than doing a fresh install, you must run the following migration scripts to update your database schema:

1.  **Add Sharing Flag** (Adds `is_shared` column to materials and sites):
    ```bash
    node db/migrations/add_shared_flag.js
    ```

2.  **Add Co-Instructors Support** (Creates `course_instructors` table and migrates data):
    ```bash
    node db/migrations/add_co_instructors.js
    ```

> **Note:** These scripts are safe to run multiple times, but it's always recommended to back up your `db/lms.db` file before running migrations.
