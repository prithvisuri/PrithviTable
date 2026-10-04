# MySQL Table Viewer

A login-protected web app for browsing and managing MySQL tables. Signed-in users can add, edit, and delete rows; create and delete tables; and add, rename, and delete columns. The browser only calls the app's API; MySQL credentials stay on the server.

## Run locally with Docker Compose

```sh
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) and sign in with:

- Login ID: `admin`
- Password: `Admin123!`

Compose starts MySQL in a separate container, creates the example `appdata.demo_records` table, and seeds a few rows. These credentials are for local development only. Set `APP_LOGIN_PASSWORD`, `SESSION_SECRET`, `MYSQL_PASSWORD`, and `MYSQL_ROOT_PASSWORD` before using this setup outside a local environment.

To stop the containers, run `docker compose down`. The database volume persists; the SQL initialization script runs only when the volume is first created.

## Connect to an existing MySQL container or Kubernetes pod

Set the app's environment variables to the MySQL service/container network address and credentials:

| Variable | Example | Purpose |
| --- | --- | --- |
| `MYSQL_HOST` | `mysql` or `mysql.database.svc.cluster.local` | MySQL service DNS name (not `localhost` when MySQL is in another pod/container) |
| `MYSQL_PORT` | `3306` | MySQL service port |
| `MYSQL_DATABASE` | `appdata` | Database containing the table |
| `MYSQL_TABLE` | `demo_records` | Table to display; letters, numbers, and underscores only |
| `MYSQL_USER` | `viewer` | MySQL user with `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, and `ALTER` permissions on the database |
| `MYSQL_PASSWORD` | Set through a secret | MySQL password |

The app configuration example is in `k8s/app.yaml`. Build and push the image, update its `image` field, and ensure `MYSQL_HOST` is the DNS name of a reachable MySQL Kubernetes Service. Create the referenced Kubernetes Secret before applying the manifest:

```sh
kubectl create secret generic mysql-table-viewer-secrets \
  --from-literal=app-login-password='replace-with-a-strong-password' \
  --from-literal=session-secret='replace-with-a-long-random-secret' \
  --from-literal=mysql-user='viewer' \
  --from-literal=mysql-password='your-mysql-password'
kubectl apply -f k8s/app.yaml
```

`APP_LOGIN_ID` defaults to `admin` and can be changed in the ConfigMap. Change the example app password before deployment. The cookie is HTTP-only and same-site; HTTPS deployments also mark it Secure. Sessions expire after eight hours.

The table manager creates tables with an auto-generated integer `id` primary key. Supported column types are `VARCHAR(255)`, `INT`, `BIGINT`, `TEXT`, `DATE`, `DATETIME`, `DECIMAL(10,2)`, and `BOOLEAN`. Row edit/delete is enabled only for tables with a primary key. Primary-key columns cannot be deleted; data loss operations ask for confirmation.

The API reports configuration, permission, and connection problems in the page rather than showing an empty success state.
