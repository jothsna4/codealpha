const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database("project_manager.db");
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "internship-demo-secret-change-me";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT,
 owner_id INTEGER NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_members(
 project_id INTEGER,
 user_id INTEGER,
 PRIMARY KEY(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS tasks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 description TEXT,
 status TEXT DEFAULT 'todo',
 assignee_id INTEGER,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const seed = db.prepare("SELECT id FROM users LIMIT 1").get();
if (!seed) {
  const hash = bcrypt.hashSync("password123", 10);
  db.prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)")
    .run("Demo User","demo@example.com",hash);
}

function auth(req,res,next){
  const token = (req.headers.authorization || "").replace("Bearer ","");
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Please login first"}); }
}
function tokenFor(user){ return jwt.sign({id:user.id,email:user.email,name:user.name},JWT_SECRET,{expiresIn:"2h"}); }

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:"All fields are required"});
  try{
    const hash=bcrypt.hashSync(password,10);
    const info=db.prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)").run(name,email.toLowerCase(),hash);
    const user={id:info.lastInsertRowid,name,email:email.toLowerCase()};
    res.json({user,token:tokenFor(user)});
  }catch(e){ res.status(400).json({error:"Email already registered"}); }
});

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const user=db.prepare("SELECT * FROM users WHERE email=?").get((email||"").toLowerCase());
  if(!user || !bcrypt.compareSync(password||"",user.password)) return res.status(401).json({error:"Invalid email or password"});
  const safe={id:user.id,name:user.name,email:user.email};
  res.json({user:safe,token:tokenFor(safe)});
});

app.get("/api/me",auth,(req,res)=>res.json(req.user));

app.get("/api/projects",auth,(req,res)=>{
  const rows=db.prepare(`
    SELECT p.*, u.name AS owner_name
    FROM projects p JOIN users u ON u.id=p.owner_id
    WHERE p.owner_id=? OR p.id IN (SELECT project_id FROM project_members WHERE user_id=?)
    ORDER BY p.id DESC`).all(req.user.id,req.user.id);
  res.json(rows);
});

app.post("/api/projects",auth,(req,res)=>{
  const {name,description=""}=req.body;
  if(!name) return res.status(400).json({error:"Project name is required"});
  const info=db.prepare("INSERT INTO projects(name,description,owner_id) VALUES(?,?,?)").run(name,description,req.user.id);
  db.prepare("INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)").run(info.lastInsertRowid,req.user.id);
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(info.lastInsertRowid);
  io.emit("projectCreated",project);
  res.json(project);
});

app.post("/api/projects/:id/members",auth,(req,res)=>{
  const {email}=req.body;
  const project=db.prepare("SELECT * FROM projects WHERE id=? AND owner_id=?").get(req.params.id,req.user.id);
  if(!project) return res.status(403).json({error:"Only the project owner can add members"});
  const member=db.prepare("SELECT id,name,email FROM users WHERE email=?").get((email||"").toLowerCase());
  if(!member) return res.status(404).json({error:"User not found. Ask them to register first."});
  db.prepare("INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)").run(project.id,member.id);
  res.json({message:"Member added",member});
});

app.get("/api/projects/:id/tasks",auth,(req,res)=>{
  const member=db.prepare(`SELECT 1 FROM project_members WHERE project_id=? AND user_id=?`).get(req.params.id,req.user.id);
  if(!member) return res.status(403).json({error:"You are not a project member"});
  const rows=db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.project_id=? ORDER BY t.id DESC`).all(req.params.id);
  res.json(rows);
});

app.post("/api/projects/:id/tasks",auth,(req,res)=>{
  const member=db.prepare(`SELECT 1 FROM project_members WHERE project_id=? AND user_id=?`).get(req.params.id,req.user.id);
  if(!member) return res.status(403).json({error:"You are not a project member"});
  const {title,description="",assignee_id=null,status="todo"}=req.body;
  if(!title) return res.status(400).json({error:"Task title is required"});
  const info=db.prepare("INSERT INTO tasks(project_id,title,description,status,assignee_id) VALUES(?,?,?,?,?)")
    .run(req.params.id,title,description,status,assignee_id||null);
  const task=db.prepare(`SELECT t.*,u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=?`).get(info.lastInsertRowid);
  io.to("project-"+req.params.id).emit("taskChanged",task);
  res.json(task);
});

app.patch("/api/tasks/:id",auth,(req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if(!task) return res.status(404).json({error:"Task not found"});
  const member=db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(task.project_id,req.user.id);
  if(!member) return res.status(403).json({error:"Not a project member"});
  const status=req.body.status ?? task.status;
  const assignee_id=req.body.assignee_id ?? task.assignee_id;
  db.prepare("UPDATE tasks SET status=?,assignee_id=? WHERE id=?").run(status,assignee_id||null,task.id);
  const updated=db.prepare(`SELECT t.*,u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=?`).get(task.id);
  io.to("project-"+task.project_id).emit("taskChanged",updated);
  res.json(updated);
});

app.get("/api/tasks/:id/comments",auth,(req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if(!task) return res.status(404).json({error:"Task not found"});
  const member=db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(task.project_id,req.user.id);
  if(!member) return res.status(403).json({error:"Not a project member"});
  res.json(db.prepare(`SELECT c.*,u.name user_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.id`).all(task.id));
});

app.post("/api/tasks/:id/comments",auth,(req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  const text=(req.body.text||"").trim();
  if(!task||!text) return res.status(400).json({error:"Task and comment are required"});
  const member=db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(task.project_id,req.user.id);
  if(!member) return res.status(403).json({error:"Not a project member"});
  const info=db.prepare("INSERT INTO comments(task_id,user_id,text) VALUES(?,?,?)").run(task.id,req.user.id,text);
  const comment=db.prepare(`SELECT c.*,u.name user_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(info.lastInsertRowid);
  io.to("project-"+task.project_id).emit("newComment",comment);
  res.json(comment);
});

io.on("connection",(socket)=>{
  socket.on("joinProject",(projectId)=>socket.join("project-"+projectId));
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log(`Project Manager running at http://localhost:${PORT}`));
