# ProjectFlow — Project Management Tool

A full-stack Trello/Asana-style internship project.

## Features
- User registration and JWT authentication
- Login/logout
- Create group projects
- Add registered members by email
- Project boards with To Do / In Progress / Done columns
- Create and assign tasks
- Change task status
- Task comments
- SQLite database
- WebSocket real-time task/comment updates using Socket.IO
- Responsive UI

## Tech Stack
Frontend: HTML, CSS, JavaScript
Backend: Node.js, Express.js
Database: SQLite (better-sqlite3)
Authentication: JWT + bcrypt
Realtime: Socket.IO

## Run
1. Install Node.js LTS.
2. Open this folder in VS Code.
3. Open Terminal.
4. Run:
   npm install
5. Then:
   npm start
6. Open:
   http://localhost:3000

Demo login:
Email: demo@example.com
Password: password123

## Database
The SQLite database file `project_manager.db` is created automatically after first run.

## Internship presentation
Explain the architecture as:
Browser → Express REST API → SQLite database
                         ↘ Socket.IO → real-time updates

Backend responsibilities:
- Users/authentication
- Projects and membership
- Tasks and assignments
- Comments
- Real-time events
