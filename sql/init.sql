CREATE TABLE IF NOT EXISTS demo_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL,
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO demo_records (name, department, status)
VALUES
  ('Avery Chen', 'Engineering', 'Active'),
  ('Jordan Rivera', 'Operations', 'Active'),
  ('Sam Taylor', 'Design', 'Onboarding');
