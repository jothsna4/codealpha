const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 3000;
const db = new sqlite3.Database("./store.db");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: "simple-ecommerce-secret",
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, "public")));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  db.get("SELECT COUNT(*) AS count FROM products", (err, row) => {
    if (!err && row.count === 0) {
      const stmt = db.prepare(
        "INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)"
      );
      stmt.run("Wireless Headphones", "Comfortable wireless headphones with clear sound.", 1499, "🎧");
      stmt.run("Smart Watch", "Smart watch with fitness and notification features.", 2499, "⌚");
      stmt.run("Laptop Backpack", "Water-resistant backpack suitable for college and office.", 999, "🎒");
      stmt.run("Bluetooth Speaker", "Portable speaker with powerful audio.", 1299, "🔊");
      stmt.finalize();
    }
  });
});

app.get("/api/products", (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
  });
});

app.get("/api/products/:id", (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!row) return res.status(404).json({ error: "Product not found" });
    res.json(row);
  });
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
    [name, email, hashedPassword],
    function(err) {
      if (err) {
        return res.status(400).json({ error: "Email already registered" });
      }
      res.json({ message: "Registration successful" });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    req.session.userId = user.id;
    req.session.userName = user.name;

    res.json({ message: "Login successful", name: user.name });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    id: req.session.userId,
    name: req.session.userName
  });
});

app.post("/api/orders", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please login before placing an order" });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  const ids = items.map(item => Number(item.productId));
  const placeholders = ids.map(() => "?").join(",");

  db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, ids, (err, products) => {
    if (err) return res.status(500).json({ error: "Database error" });

    const productMap = {};
    products.forEach(p => productMap[p.id] = p);

    let total = 0;
    for (const item of items) {
      const product = productMap[Number(item.productId)];
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ error: "Invalid cart item" });
      }
      total += product.price * quantity;
    }

    db.run(
      "INSERT INTO orders (user_id, total) VALUES (?, ?)",
      [req.session.userId, total],
      function(orderErr) {
        if (orderErr) return res.status(500).json({ error: "Could not create order" });

        const orderId = this.lastID;
        const stmt = db.prepare(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)"
        );

        items.forEach(item => {
          const product = productMap[Number(item.productId)];
          stmt.run(orderId, product.id, Number(item.quantity), product.price);
        });

        stmt.finalize(() => {
          res.json({ message: "Order placed successfully", orderId, total });
        });
      }
    );
  });
});

app.get("/api/orders", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please login" });
  }

  db.all(
    "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json(rows);
    }
  );
});

app.listen(PORT, () => {
  console.log(`E-commerce store running at http://localhost:${PORT}`);
});