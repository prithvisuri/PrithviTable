const loginView = document.querySelector("#login-view");
const dataView = document.querySelector("#data-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const dataMessage = document.querySelector("#data-message");
const tableCaption = document.querySelector("#table-caption");
const table = document.querySelector("#data-table");
const addRowPanel = document.querySelector("#add-row-panel");
const addRowButton = document.querySelector("#add-row-button");
const addRowForm = document.querySelector("#add-row-form");
const addRowFields = document.querySelector("#add-row-fields");
const addRowError = document.querySelector("#add-row-error");
const editRowPanel = document.querySelector("#edit-row-panel");
const editRowForm = document.querySelector("#edit-row-form");
const editRowFields = document.querySelector("#edit-row-fields");
const editRowError = document.querySelector("#edit-row-error");
const tablePicker = document.querySelector("#table-picker");
const createTablePanel = document.querySelector("#create-table-panel");
const createTableForm = document.querySelector("#create-table-form");
const createTableColumns = document.querySelector("#create-table-columns");
const createTableError = document.querySelector("#create-table-error");
const columnsPanel = document.querySelector("#manage-columns-panel");
const columnList = document.querySelector("#column-list");
const addColumnForm = document.querySelector("#add-column-form");
const addColumnError = document.querySelector("#add-column-error");
const dataTableBody = table.querySelector("tbody");
const dataTableHead = table.querySelector("thead");
const columnTypes = ["VARCHAR(255)", "INT", "BIGINT", "TEXT", "DATE", "DATETIME", "DECIMAL(10,2)", "BOOLEAN"];
let currentTable = "";
let currentSchema = [];
let currentPrimaryKey = [];
let editingKey = null;

for (const type of columnTypes) {
  const option = document.createElement("option");
  option.value = type;
  option.textContent = type;
  document.querySelector("#new-column-type").append(option);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function showLogin() {
  document.querySelector(".page-shell").classList.remove("is-authenticated");
  dataView.hidden = true;
  loginView.hidden = false;
}

function renderTable(result) {
  currentTable = result.table;
  currentSchema = result.schema;
  currentPrimaryKey = result.primaryKey;
  tableCaption.textContent = `Table: ${result.table} · ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`;
  tablePicker.value = result.table;
  renderAddRowFields(result.insertableColumns);
  renderColumnList(result.schema);
  dataTableHead.replaceChildren();
  dataTableBody.replaceChildren();
  document.querySelector("#delete-table-button").disabled = false;
  document.querySelector("#add-row-button").disabled = false;

  if (result.columns.length === 0) {
    dataTableBody.innerHTML = '<tr><td class="empty-cell">This table has no columns.</td></tr>';
    return;
  }

  const headerRow = document.createElement("tr");
  for (const column of [...result.columns, "Actions"]) {
    const cell = document.createElement("th");
    cell.textContent = column;
    headerRow.append(cell);
  }
  dataTableHead.append(headerRow);

  if (result.rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-cell";
    cell.colSpan = result.columns.length + 1;
    cell.textContent = "No rows found in this table.";
    row.append(cell);
    dataTableBody.append(row);
    return;
  }

  for (const record of result.rows) {
    const row = document.createElement("tr");
    for (const column of result.columns) {
      const cell = document.createElement("td");
      const value = record[column];
      cell.textContent = value === null ? "NULL" : String(value);
      row.append(cell);
    }
    const actions = document.createElement("td");
    const key = Object.fromEntries(currentPrimaryKey.map((name) => [name, record[name]]));
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "row-action";
    editButton.textContent = "Edit";
    editButton.disabled = currentPrimaryKey.length === 0;
    editButton.title = editButton.disabled ? "This table has no primary key" : "Edit this row";
    editButton.addEventListener("click", () => openEditRow(record, key));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "row-action danger-text";
    deleteButton.textContent = "Delete";
    deleteButton.disabled = currentPrimaryKey.length === 0;
    deleteButton.title = deleteButton.disabled ? "This table has no primary key" : "Delete this row";
    deleteButton.addEventListener("click", () => deleteRow(key));
    actions.append(editButton, deleteButton);
    row.append(actions);
    dataTableBody.append(row);
  }
}

function appendFields(container, columns, prefix, values = {}, editableNames = null) {
  container.replaceChildren();
  const editable = editableNames ? new Set(editableNames) : null;

  for (const column of columns) {
    if (editable && !editable.has(column.name)) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "form-field";
    const label = document.createElement("label");
    const input = document.createElement("input");
    const fieldType = inputType(column.type);

    label.htmlFor = `${prefix}-${column.name}`;
    label.textContent = column.name;
    if (column.required && !editable) {
      label.append(document.createTextNode(" *"));
    }
    input.id = `${prefix}-${column.name}`;
    input.name = column.name;
    input.type = fieldType;
    input.required = column.required;
    if (Object.hasOwn(values, column.name) && values[column.name] !== null) {
      const value = values[column.name];
      input.value = fieldType === "datetime-local" ? String(value).replace(" ", "T").slice(0, 16) : value;
    }
    if (fieldType === "number") input.step = "any";
    wrapper.append(label, input);
    container.append(wrapper);
  }
}

function inputType(mysqlType) {
  const type = mysqlType.toLowerCase();
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double)/.test(type)) return "number";
  if (type.startsWith("date") && !type.startsWith("datetime")) return "date";
  if (type.startsWith("datetime") || type.startsWith("timestamp")) return "datetime-local";
  if (type.startsWith("time")) return "time";
  return "text";
}

function renderAddRowFields(columns) {
  appendFields(addRowFields, columns, "new");
  const saveButton = document.querySelector("#save-row-button");
  if (columns.length === 0) {
    const message = document.createElement("p");
    message.className = "form-hint";
    message.textContent = "All values are generated by the database. Saving will add a row with default values.";
    addRowFields.append(message);
    saveButton.disabled = false;
  } else {
    saveButton.disabled = false;
  }
}

function renderColumnList(columns) {
  columnList.replaceChildren();
  for (const column of columns) {
    const item = document.createElement("div");
    item.className = "column-list-item";
    const details = document.createElement("span");
    details.textContent = `${column.name} · ${column.type}`;
    const actions = document.createElement("div");
    actions.className = "column-actions";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "row-action";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => renameColumn(column.name));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "row-action danger-text";
    remove.textContent = "Delete";
    remove.disabled = column.primary;
    remove.title = remove.disabled ? "Primary-key columns cannot be deleted" : "Delete this column";
    remove.addEventListener("click", () => deleteColumn(column.name));
    actions.append(rename, remove);
    item.append(details, actions);
    columnList.append(item);
  }
}

function setAddRowOpen(isOpen) {
  addRowPanel.hidden = !isOpen;
  addRowButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) addRowFields.querySelector("input")?.focus();
}

async function loadTable() {
  dataView.hidden = false;
  loginView.hidden = true;
  dataMessage.textContent = "";
  dataMessage.classList.remove("error");
  tableCaption.textContent = "Loading your data…";

  try {
    const name = tablePicker.value || currentTable;
    renderTable(await request(`/api/table?name=${encodeURIComponent(name)}`));
  } catch (error) {
    if (error.message === "Please log in to continue.") {
      showLogin();
      return;
    }
    tableCaption.textContent = "Your table could not be loaded.";
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
}

async function loadTables(selected = currentTable) {
  const result = await request("/api/tables");
  tablePicker.replaceChildren();
  for (const name of result.tables) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    tablePicker.append(option);
  }
  if (result.tables.length === 0) {
    currentTable = "";
    tableCaption.textContent = "No tables yet. Create one to get started.";
    dataTableHead.replaceChildren();
    dataTableBody.replaceChildren();
    document.querySelector("#delete-table-button").disabled = true;
    document.querySelector("#add-row-button").disabled = true;
    document.querySelector("#manage-columns-button").disabled = true;
    return false;
  }
  document.querySelector("#manage-columns-button").disabled = false;
  const next = result.tables.includes(selected) ? selected : result.tables[0];
  tablePicker.value = next;
  await loadTable();
  return true;
}

async function reloadTables(selected = currentTable) {
  document.querySelector(".page-shell").classList.add("is-authenticated");
  dataView.hidden = false;
  loginView.hidden = true;
  dataMessage.textContent = "";
  dataMessage.classList.remove("error");
  try {
    return await loadTables(selected);
  } catch (error) {
    if (error.message === "Please log in to continue.") {
      showLogin();
      return false;
    }
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
    return false;
  }
}

function openEditRow(record, key) {
  editingKey = key;
  const editable = currentSchema.filter((column) => !column.primary && !column.generated);
  appendFields(editRowFields, editable, "edit", record, editable.map((column) => column.name));
  editRowError.hidden = true;
  editRowPanel.hidden = false;
  editRowPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  editRowFields.querySelector("input")?.focus();
}

async function deleteRow(key) {
  if (!window.confirm("Delete this row? This cannot be undone.")) return;
  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/rows`, {
      method: "DELETE",
      body: JSON.stringify({ key })
    });
    await loadTable();
    dataMessage.textContent = "Row deleted.";
  } catch (error) {
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
}

function addColumnEditor() {
  const item = document.createElement("div");
  item.className = "column-editor-row";
  const name = document.createElement("input");
  name.name = "column-name";
  name.placeholder = "Column name";
  name.pattern = "[A-Za-z0-9_]{1,64}";
  name.required = true;
  name.setAttribute("aria-label", "New column name");
  const type = document.createElement("select");
  type.name = "column-type";
  type.setAttribute("aria-label", "New column type");
  for (const columnType of columnTypes) {
    const option = document.createElement("option");
    option.value = columnType;
    option.textContent = columnType;
    type.append(option);
  }
  const requiredLabel = document.createElement("label");
  requiredLabel.className = "checkbox-label compact-checkbox";
  const required = document.createElement("input");
  required.type = "checkbox";
  required.name = "column-required";
  requiredLabel.append(required, document.createTextNode("Required"));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "row-action danger-text";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => item.remove());
  item.append(name, type, requiredLabel, remove);
  createTableColumns.append(item);
}

async function createTable(event) {
  event.preventDefault();
  createTableError.hidden = true;
  const columns = Array.from(createTableColumns.children, (item) => ({
    name: item.querySelector('[name="column-name"]').value,
    type: item.querySelector('[name="column-type"]').value,
    required: item.querySelector('[name="column-required"]').checked
  }));
  try {
    const form = new FormData(createTableForm);
    const result = await request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), columns })
    });
    createTableForm.reset();
    createTableColumns.replaceChildren();
    createTablePanel.hidden = true;
    await reloadTables(result.table);
    dataMessage.textContent = `Table "${result.table}" created.`;
  } catch (error) {
    createTableError.textContent = error.message;
    createTableError.hidden = false;
  }
}

async function renameColumn(name) {
  const newName = window.prompt(`Rename column "${name}" to:`, name);
  if (newName === null || newName === name) return;
  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/columns/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ newName })
    });
    await loadTable();
    dataMessage.textContent = `Column "${name}" renamed to "${newName}".`;
  } catch (error) {
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
}

async function deleteColumn(name) {
  if (!window.confirm(`Delete column "${name}" and all its values? This cannot be undone.`)) return;
  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/columns/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    await loadTable();
    dataMessage.textContent = `Column "${name}" deleted.`;
  } catch (error) {
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const form = new FormData(loginForm);
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        id: form.get("id"),
        password: form.get("password")
      })
    });
    loginForm.reset();
    await reloadTables();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

tablePicker.addEventListener("change", () => {
  setAddRowOpen(false);
  editRowPanel.hidden = true;
  reloadTables(tablePicker.value);
});

document.querySelector("#add-row-button").addEventListener("click", () => {
  editRowPanel.hidden = true;
  addRowPanel.hidden = !addRowPanel.hidden;
  addRowButton.setAttribute("aria-expanded", String(!addRowPanel.hidden));
  addRowError.hidden = true;
});

document.querySelector("#create-table-button").addEventListener("click", () => {
  columnsPanel.hidden = true;
  document.querySelector("#manage-columns-button").setAttribute("aria-expanded", "false");
  createTablePanel.hidden = !createTablePanel.hidden;
  if (createTableColumns.children.length === 0) addColumnEditor();
});

for (const id of ["close-create-table", "cancel-create-table"]) {
  document.querySelector(`#${id}`).addEventListener("click", () => {
    createTablePanel.hidden = true;
    createTableError.hidden = true;
  });
}

document.querySelector("#add-create-column").addEventListener("click", addColumnEditor);
createTableForm.addEventListener("submit", createTable);

document.querySelector("#manage-columns-button").addEventListener("click", () => {
  addRowPanel.hidden = true;
  editRowPanel.hidden = true;
  columnsPanel.hidden = !columnsPanel.hidden;
  document.querySelector("#manage-columns-button").setAttribute("aria-expanded", String(!columnsPanel.hidden));
  addColumnError.hidden = true;
});

document.querySelector("#close-manage-columns").addEventListener("click", () => {
  columnsPanel.hidden = true;
  document.querySelector("#manage-columns-button").setAttribute("aria-expanded", "false");
});

document.querySelector("#delete-table-button").addEventListener("click", async () => {
  if (!currentTable || !window.confirm(`Delete table "${currentTable}" and all its data? This cannot be undone.`)) return;
  try {
    const deleted = currentTable;
    await request(`/api/tables/${encodeURIComponent(currentTable)}`, { method: "DELETE" });
    await reloadTables();
    dataMessage.textContent = `Table "${deleted}" deleted.`;
  } catch (error) {
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
});

addColumnForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addColumnError.hidden = true;
  const form = new FormData(addColumnForm);
  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/columns`, {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        type: form.get("type"),
        required: form.has("required")
      })
    });
    addColumnForm.reset();
    await loadTable();
    dataMessage.textContent = "Column added.";
  } catch (error) {
    addColumnError.textContent = error.message;
    addColumnError.hidden = false;
  }
});

for (const id of ["cancel-edit-row", "cancel-edit-row-secondary"]) {
  document.querySelector(`#${id}`).addEventListener("click", () => {
    editRowPanel.hidden = true;
    editRowError.hidden = true;
    editRowForm.reset();
  });
}

editRowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  editRowError.hidden = true;
  const values = Object.fromEntries(
    Array.from(new FormData(editRowForm), ([name, value]) => {
      const formatted = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value.replace("T", " ") : value;
      return [name, formatted];
    })
  );
  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/rows`, {
      method: "PUT",
      body: JSON.stringify({ key: editingKey, values })
    });
    editRowPanel.hidden = true;
    editRowForm.reset();
    await loadTable();
    dataMessage.textContent = "Row updated.";
  } catch (error) {
    editRowError.textContent = error.message;
    editRowError.hidden = false;
  }
});

document.querySelector("#toggle-password").addEventListener("click", (event) => {
  const password = document.querySelector("#password");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/logout", { method: "POST" });
    showLogin();
  } catch (error) {
    dataMessage.textContent = error.message;
    dataMessage.classList.add("error");
  }
});

for (const buttonId of ["cancel-add-row", "cancel-add-row-secondary"]) {
  document.querySelector(`#${buttonId}`).addEventListener("click", () => {
    setAddRowOpen(false);
    addRowForm.reset();
    addRowError.hidden = true;
  });
}

addRowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addRowError.hidden = true;
  const submitButton = document.querySelector("#save-row-button");
  submitButton.disabled = true;
  const values = Object.fromEntries(
    Array.from(new FormData(addRowForm), ([name, value]) => {
      const formattedValue =
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
          ? value.replace("T", " ")
          : value;
      return [name, formattedValue];
    }).filter(([name, value]) => {
      const input = addRowForm.elements.namedItem(name);
      return value !== "" || input.required;
    })
  );

  try {
    await request(`/api/tables/${encodeURIComponent(currentTable)}/rows`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    addRowForm.reset();
    setAddRowOpen(false);
    await loadTable();
    dataMessage.textContent = "Row added successfully.";
  } catch (error) {
    addRowError.textContent = error.message;
    addRowError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});
