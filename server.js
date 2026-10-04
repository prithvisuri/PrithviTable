const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
const port = Number(process.env.PORT || 3000);
const loginId = process.env.APP_LOGIN_ID || "admin";
const loginPassword = process.env.APP_LOGIN_PASSWORD || "Admin123!";
const sessionSecret =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionDurationSeconds = 8 * 60 * 60;
const defaultTableName = process.env.MYSQL_TABLE || "demo_records";
const columnTypes = new Set([
  "VARCHAR(255)",
  "INT",
  "BIGINT",
  "TEXT",
  "DATE",
  "DATETIME",
  "DECIMAL(10,2)",
  "BOOLEAN"
]);

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 5000
});

app.use(express.json({ limit: "10kb" }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function isAuthenticated(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="))
    ?.slice("session=".length);

  if (!token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Number.isInteger(session.expiresAt) && session.expiresAt > Date.now() / 1000;
  } catch {
    return false;
  }
}

function requireAuthentication(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: "Please log in to continue." });
  }
  return next();
}

function databaseIsConfigured(res) {
  const requiredSettings = [
    "MYSQL_HOST",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE"
  ];
  const missingSettings = requiredSettings.filter((name) => !process.env[name]);
  if (missingSettings.length === 0) return true;
  res.status(503).json({
    error: `Database is not configured. Set: ${missingSettings.join(", ")}.`
  });
  return false;
}

function isValidIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value);
}

function quoteIdentifier(value) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function isGeneratedColumn(column) {
  return /auto_increment|(?:virtual|stored)\s+generated|generated always/i.test(
    column.Extra || ""
  );
}

function validateValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return "Provide row values as an object.";
  }
  for (const [name, value] of Object.entries(values)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return `Invalid value for ${name}.`;
    }
  }
  return null;
}

function validatePrimaryKey(key, primaryColumns) {
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    return "A primary key is required to identify this row.";
  }
  const suppliedColumns = Object.keys(key).sort();
  const expectedColumns = primaryColumns.map((column) => column.Field).sort();
  if (
    expectedColumns.length === 0 ||
    suppliedColumns.length !== expectedColumns.length ||
    suppliedColumns.some((column, index) => column !== expectedColumns[index]) ||
    Object.values(key).some((value) => value === null || value === undefined)
  ) {
    return "The row primary key is invalid.";
  }
  return null;
}

async function getSchema(name) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${quoteIdentifier(name)}`);
  return columns;
}

async function tableExists(name) {
  const [rows] = await pool.execute(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
    [process.env.MYSQL_DATABASE, name]
  );
  return rows.length > 0;
}

function validateColumnDefinition(column) {
  if (
    !column ||
    typeof column !== "object" ||
    !isValidIdentifier(column.name) ||
    typeof column.type !== "string" ||
    !columnTypes.has(column.type.toUpperCase())
  ) {
    return "Use a valid column name and a supported type.";
  }
  return null;
}

app.post("/api/login", (req, res) => {
  const { id, password } = req.body || {};
  if (
    typeof id !== "string" ||
    typeof password !== "string" ||
    !safeEqual(id, loginId) ||
    !safeEqual(password, loginPassword)
  ) {
    return res.status(401).json({ error: "Invalid login ID or password." });
  }

  res.setHeader(
    "Set-Cookie",
    `session=${createSessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationSeconds}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return res.json({ authenticated: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  return res.json({ authenticated: false });
});

app.get("/api/tables", requireAuthentication, async (_req, res) => {
  if (!databaseIsConfigured(res)) return;
  try {
    const [rows] = await pool.execute(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
      [process.env.MYSQL_DATABASE]
    );
    return res.json({ tables: rows.map((row) => row.name) });
  } catch (error) {
    console.error("MySQL table listing failed:", error.message);
    return res.status(503).json({ error: "Could not list database tables." });
  }
});

app.get("/api/table", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.query.name || defaultTableName;
  if (!isValidIdentifier(name)) {
    return res.status(400).json({ error: "Invalid table name." });
  }
  try {
    const schema = await getSchema(name);
    const [rows, fields] = await pool.query(
      `SELECT * FROM ${quoteIdentifier(name)} LIMIT 200`
    );
    return res.json({
      table: name,
      columns: fields.map((field) => field.name),
      primaryKey: schema.filter((column) => column.Key === "PRI").map((column) => column.Field),
      schema: schema.map((column) => ({
        name: column.Field,
        type: column.Type,
        primary: column.Key === "PRI",
        generated: isGeneratedColumn(column),
        required: column.Null === "NO" && column.Default === null
      })),
      insertableColumns: schema
        .filter((column) => !isGeneratedColumn(column))
        .map((column) => ({
          name: column.Field,
          type: column.Type,
          required: column.Null === "NO" && column.Default === null
        })),
      rows
    });
  } catch (error) {
    console.error("MySQL table query failed:", error.message);
    return res.status(503).json({
      error: `Could not load table "${name}". Check that it exists and the MySQL connection is available.`
    });
  }
});

app.post("/api/tables/:table/rows", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  if (!isValidIdentifier(name)) return res.status(400).json({ error: "Invalid table name." });
  const values = req.body;
  const valuesError = validateValues(values);
  if (valuesError) return res.status(400).json({ error: valuesError });

  try {
    const schema = await getSchema(name);
    const insertable = schema.filter(
      (column) => !isGeneratedColumn(column)
    );
    const allowed = new Map(insertable.map((column) => [column.Field, column]));
    const unknownColumns = Object.keys(values).filter((name) => !allowed.has(name));
    if (unknownColumns.length > 0) {
      return res.status(400).json({
        error: `Unknown or non-editable column: ${unknownColumns.join(", ")}.`
      });
    }

    const missingColumns = insertable
      .filter(
        (column) =>
          column.Null === "NO" &&
          column.Default === null &&
          !Object.prototype.hasOwnProperty.call(values, column.Field)
      )
      .map((column) => column.Field);
    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: `Required fields are missing: ${missingColumns.join(", ")}.`
      });
    }

    for (const [name, value] of Object.entries(values)) {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return res.status(400).json({ error: `Invalid value for ${name}.` });
      }
      if (
        allowed.get(name).Null === "NO" &&
        (value === null || value === "")
      ) {
        return res.status(400).json({ error: `${name} cannot be empty.` });
      }
    }

    const entries = Object.entries(values);
    const statement = entries.length
      ? `INSERT INTO ${quoteIdentifier(name)} (${entries
          .map(([column]) => quoteIdentifier(column))
          .join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`
      : `INSERT INTO ${quoteIdentifier(name)} () VALUES ()`;
    await pool.execute(statement, entries.map(([, value]) => value));
    return res.status(201).json({ created: true });
  } catch (error) {
    console.error("MySQL row insert failed:", error.message);
    return res.status(503).json({
      error: "Could not add the row. Check the MySQL connection and table schema."
    });
  }
});

app.put("/api/tables/:table/rows", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  if (!isValidIdentifier(name)) return res.status(400).json({ error: "Invalid table name." });
  const { key, values } = req.body || {};
  const valuesError = validateValues(values);
  if (valuesError) return res.status(400).json({ error: valuesError });
  if (Object.keys(values).length === 0) {
    return res.status(400).json({ error: "Provide at least one value to update." });
  }

  try {
    const schema = await getSchema(name);
    const primaryColumns = schema.filter((column) => column.Key === "PRI");
    const keyError = validatePrimaryKey(key, primaryColumns);
    if (keyError) return res.status(400).json({ error: keyError });
    const editable = schema.filter(
      (column) =>
        column.Key !== "PRI" && !isGeneratedColumn(column)
    );
    const allowed = new Set(editable.map((column) => column.Field));
    const unknown = Object.keys(values).filter((column) => !allowed.has(column));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown or non-editable column: ${unknown.join(", ")}.` });
    }
    for (const [column, value] of Object.entries(values)) {
      const definition = editable.find((item) => item.Field === column);
      if (definition.Null === "NO" && (value === null || value === "")) {
        return res.status(400).json({ error: `${column} cannot be empty.` });
      }
    }

    const assignments = Object.entries(values)
      .map(([column]) => `${quoteIdentifier(column)} = ?`)
      .join(", ");
    const conditions = primaryColumns
      .map((column) => `${quoteIdentifier(column.Field)} = ?`)
      .join(" AND ");
    const parameters = [
      ...Object.values(values),
      ...primaryColumns.map((column) => key[column.Field])
    ];
    const [result] = await pool.execute(
      `UPDATE ${quoteIdentifier(name)} SET ${assignments} WHERE ${conditions}`,
      parameters
    );
    if (result.affectedRows === 0) {
      const [matches] = await pool.execute(
        `SELECT 1 FROM ${quoteIdentifier(name)} WHERE ${conditions} LIMIT 1`,
        primaryColumns.map((column) => key[column.Field])
      );
      if (matches.length === 0) {
        return res.status(404).json({ error: "The row no longer exists." });
      }
    }
    return res.json({ updated: true });
  } catch (error) {
    console.error("MySQL row update failed:", error.message);
    return res.status(503).json({ error: "Could not update the row. Check the MySQL connection and table schema." });
  }
});

app.delete("/api/tables/:table/rows", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  if (!isValidIdentifier(name)) return res.status(400).json({ error: "Invalid table name." });
  try {
    const schema = await getSchema(name);
    const primaryColumns = schema.filter((column) => column.Key === "PRI");
    const keyError = validatePrimaryKey(req.body?.key, primaryColumns);
    if (keyError) return res.status(400).json({ error: keyError });
    const conditions = primaryColumns
      .map((column) => `${quoteIdentifier(column.Field)} = ?`)
      .join(" AND ");
    const [result] = await pool.execute(
      `DELETE FROM ${quoteIdentifier(name)} WHERE ${conditions}`,
      primaryColumns.map((column) => req.body.key[column.Field])
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "The row no longer exists." });
    }
    return res.json({ deleted: true });
  } catch (error) {
    console.error("MySQL row delete failed:", error.message);
    return res.status(503).json({ error: "Could not delete the row. Check the MySQL connection and table schema." });
  }
});

app.post("/api/tables", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const { name, columns } = req.body || {};
  if (!isValidIdentifier(name)) {
    return res.status(400).json({ error: "Table names must contain 1 to 64 letters, numbers, or underscores." });
  }
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 40) {
    return res.status(400).json({ error: "Add between 1 and 40 columns." });
  }
  const seen = new Set(["id"]);
  for (const column of columns) {
    const error = validateColumnDefinition(column);
    if (error) return res.status(400).json({ error });
    if (seen.has(column.name.toLowerCase())) {
      return res.status(400).json({ error: `Duplicate column name: ${column.name}.` });
    }
    seen.add(column.name.toLowerCase());
  }
  try {
    const definitions = [
      `${quoteIdentifier("id")} INT NOT NULL AUTO_INCREMENT PRIMARY KEY`,
      ...columns.map(
        (column) =>
          `${quoteIdentifier(column.name)} ${column.type.toUpperCase()}${column.required ? " NOT NULL" : " NULL"}`
      )
    ];
    await pool.query(`CREATE TABLE ${quoteIdentifier(name)} (${definitions.join(", ")})`);
    return res.status(201).json({ created: true, table: name });
  } catch (error) {
    console.error("MySQL table creation failed:", error.message);
    return res.status(503).json({ error: "Could not create the table. Check the name, permissions, and database connection." });
  }
});

app.delete("/api/tables/:table", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  if (!isValidIdentifier(name)) return res.status(400).json({ error: "Invalid table name." });
  try {
    if (!(await tableExists(name))) return res.status(404).json({ error: "Table not found." });
    await pool.query(`DROP TABLE ${quoteIdentifier(name)}`);
    return res.json({ deleted: true });
  } catch (error) {
    console.error("MySQL table deletion failed:", error.message);
    return res.status(503).json({ error: "Could not delete the table. Check permissions and database constraints." });
  }
});

app.post("/api/tables/:table/columns", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  const column = req.body;
  if (!isValidIdentifier(name)) return res.status(400).json({ error: "Invalid table name." });
  const error = validateColumnDefinition(column);
  if (error) return res.status(400).json({ error });
  try {
    const existing = await getSchema(name);
    if (existing.some((item) => item.Field.toLowerCase() === column.name.toLowerCase())) {
      return res.status(400).json({ error: "A column with that name already exists." });
    }
    await pool.query(
      `ALTER TABLE ${quoteIdentifier(name)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.type.toUpperCase()}${column.required ? " NOT NULL" : " NULL"}`
    );
    return res.status(201).json({ created: true });
  } catch (error) {
    console.error("MySQL column addition failed:", error.message);
    return res.status(503).json({ error: "Could not add the column. A required column may need a default for existing rows." });
  }
});

app.patch("/api/tables/:table/columns/:column", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  const oldName = req.params.column;
  const { newName } = req.body || {};
  if (!isValidIdentifier(name) || !isValidIdentifier(oldName) || !isValidIdentifier(newName)) {
    return res.status(400).json({ error: "Invalid table or column name." });
  }
  try {
    const schema = await getSchema(name);
    if (!schema.some((column) => column.Field === oldName)) {
      return res.status(404).json({ error: "Column not found." });
    }
    if (schema.some((column) => column.Field.toLowerCase() === newName.toLowerCase())) {
      return res.status(400).json({ error: "A column with that name already exists." });
    }
    await pool.query(
      `ALTER TABLE ${quoteIdentifier(name)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`
    );
    return res.json({ renamed: true });
  } catch (error) {
    console.error("MySQL column rename failed:", error.message);
    return res.status(503).json({ error: "Could not rename the column. Check permissions and database constraints." });
  }
});

app.delete("/api/tables/:table/columns/:column", requireAuthentication, async (req, res) => {
  if (!databaseIsConfigured(res)) return;
  const name = req.params.table;
  const columnName = req.params.column;
  if (!isValidIdentifier(name) || !isValidIdentifier(columnName)) {
    return res.status(400).json({ error: "Invalid table or column name." });
  }
  try {
    const schema = await getSchema(name);
    const column = schema.find((item) => item.Field === columnName);
    if (!column) return res.status(404).json({ error: "Column not found." });
    if (column.Key === "PRI") {
      return res.status(400).json({ error: "Primary-key columns cannot be deleted while row management is enabled." });
    }
    if (schema.length === 1) {
      return res.status(400).json({ error: "A table must have at least one column." });
    }
    await pool.query(
      `ALTER TABLE ${quoteIdentifier(name)} DROP COLUMN ${quoteIdentifier(columnName)}`
    );
    return res.json({ deleted: true });
  } catch (error) {
    console.error("MySQL column deletion failed:", error.message);
    return res.status(503).json({ error: "Could not delete the column. Check permissions and database constraints." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, "0.0.0.0", () => {
  console.log(`MySQL table viewer listening on port ${port}`);
});
