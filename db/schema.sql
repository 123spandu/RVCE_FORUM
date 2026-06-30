-- Campus Connect Database Schema

CREATE DATABASE IF NOT EXISTS campus_connect
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE campus_connect;

SET FOREIGN_KEY_CHECKS = 0;

-- DROP TABLE IF EXISTS push_subscriptions;
-- DROP TABLE IF EXISTS audit_logs;
-- DROP TABLE IF EXISTS expired_posts;
-- DROP TABLE IF EXISTS stories;
-- DROP TABLE IF EXISTS bookmarks;
-- DROP TABLE IF EXISTS likes;
-- DROP TABLE IF EXISTS posts;
-- DROP TABLE IF EXISTS subscriptions;
-- DROP TABLE IF EXISTS channels;
-- DROP TABLE IF EXISTS clubs;
-- DROP TABLE IF EXISTS users;
-- DROP TABLE IF EXISTS departments;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(10) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Users Table
-- Supports 3 Roles: 'admin', 'publisher', 'viewer'
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin', 'publisher', 'viewer') NOT NULL,
  department_id INT NULL,
  phone_number VARCHAR(15) NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Clubs Table
CREATE TABLE IF NOT EXISTS clubs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(15) UNIQUE NOT NULL,
  description TEXT NULL,
  logo_url VARCHAR(255) NULL,
  club_head_id INT NOT NULL,
  department_id INT NULL,
  -- is_restricted deprecated: all communities are now public. Value locked to FALSE.
  is_restricted BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (club_head_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 4. Channels Table (Unified subscription target)
CREATE TABLE IF NOT EXISTS channels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('department', 'club') NOT NULL,
  department_id INT NULL UNIQUE,
  club_id INT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  logo_url VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  CONSTRAINT chk_channel_type CHECK (
    (type = 'department' AND department_id IS NOT NULL AND club_id IS NULL) OR
    (type = 'club' AND club_id IS NOT NULL AND department_id IS NULL)
  )
) ENGINE=InnoDB;

-- 5. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscriber_id INT NOT NULL,
  channel_id INT NOT NULL,
  status ENUM('pending', 'approved') NOT NULL DEFAULT 'approved',
  -- Per-community push notification opt-in (the "bell" toggle). Subscribing alone only adds posts to the feed.
  push_notifications_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sub (subscriber_id, channel_id),
  FOREIGN KEY (subscriber_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Posts Table
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NOT NULL,
  channel_id INT NULL, -- NULL means a college-wide broadcast by admin
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  level ENUM('college_wide', 'department', 'club', 'student_body') NOT NULL,
  type ENUM('meeting', 'event', 'hackathon', 'conference', 'seminar', 'workshop', 'circular') NOT NULL,
  image_url VARCHAR(255) NULL,
  community_name VARCHAR(150) NULL COMMENT 'Denormalized community name for offline/cached display',
  is_pinned BOOLEAN DEFAULT FALSE,
  scheduled_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  is_published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  INDEX idx_publish_time (is_published, scheduled_at, expires_at),
  FULLTEXT INDEX idx_search (title, body)
) ENGINE=InnoDB;

-- 7. Likes Table
CREATE TABLE IF NOT EXISTS likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_like (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Bookmarks Table
CREATE TABLE IF NOT EXISTS bookmarks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bookmark (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. Stories Table
CREATE TABLE IF NOT EXISTS stories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NOT NULL,
  media_url VARCHAR(255) NOT NULL,
  caption VARCHAR(200) NULL,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL 24 HOUR),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 10. Expired Posts Table (archive of auto-removed posts; intentionally NOT FK-linked to posts)
CREATE TABLE IF NOT EXISTS expired_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_post_id INT NOT NULL,
  publisher_id INT NOT NULL,
  channel_id INT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  level ENUM('college_wide', 'department', 'club', 'student_body') NOT NULL,
  type ENUM('meeting', 'event', 'hackathon', 'conference', 'seminar', 'workshop', 'circular') NOT NULL,
  image_url VARCHAR(255) NULL,
  is_pinned BOOLEAN DEFAULT FALSE,
  scheduled_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  original_created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_archived_at (archived_at),
  INDEX idx_publisher (publisher_id),
  INDEX idx_channel (channel_id)
) ENGINE=InnoDB;

-- 11. Audit Logs Table (admin actions such as post deletion)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL,
  action VARCHAR(60) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (action),
  INDEX idx_actor (actor_id)
) ENGINE=InnoDB;

-- 12. Web Push Subscriptions (browser push endpoints per user/device)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint VARCHAR(512) UNIQUE NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_push_user (user_id)
) ENGINE=InnoDB;

-- ============================================================================
-- 1. Departments Data
-- Standard core engineering departments at RVCE
-- ============================================================================
-- IDs 1-4 kept stable (referenced by seeded users/channels); 5-17 are the rest of RVCE.
INSERT IGNORE INTO departments (id, name, code) VALUES
(1,  'Computer Science and Engineering', 'CSE'),
(2,  'Information Science and Engineering', 'ISE'),
(3,  'Mechanical Engineering', 'ME'),
(4,  'Electronics and Communication Engineering', 'ECE'),
(5,  'Aerospace Engineering', 'AE'),
(6,  'Biotechnology', 'BT'),
(7,  'Chemical Engineering', 'CHE'),
(8,  'Civil Engineering', 'CV'),
(9,  'Electrical and Electronics Engineering', 'EEE'),
(10, 'Electronics and Instrumentation Engineering', 'EIE'),
(11, 'Industrial Engineering and Management', 'IEM'),
(12, 'Telecommunication Engineering', 'TCE'),
(13, 'Master of Computer Applications', 'MCA'),
(14, 'Mathematics', 'MAT'),
(15, 'Physics', 'PHY'),
(16, 'Chemistry', 'CHM'),
(17, 'Humanities', 'HUM');

-- ============================================================================
-- 2. Users Data
-- Roles used: 'publisher' (HODs, Club Heads) and 'viewer' (Students)
-- strictly NO admins or principals included.
-- ============================================================================
INSERT IGNORE INTO users (id, username, password_hash, full_name, role, department_id, phone_number, email) VALUES
-- HODs (Publishers)
(1, 'hod_cse', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Dr. Shobha G', 'publisher', 1, '9876500001', 'hod.cse@rvce.edu.in'),
(2, 'hod_me', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Dr. Krishna M', 'publisher', 3, '9876500002', 'hod.me@rvce.edu.in'),

-- Club Heads (Publishers)
(3, 'kavya_debsoc', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Kavya Rao', 'publisher', 2, '9876500003', 'kavyar.is22@rvce.edu.in'),
(4, 'pranav_envisage', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Pranav K', 'publisher', 4, '9876500004', 'pranavk.ec21@rvce.edu.in'),

-- Students (Viewers)
(5, 'bharath_student', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Bharath Gowda', 'viewer', 1, '9876500005', 'bharathg.cs23@rvce.edu.in'),
(6, 'shruti_student', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Shruti Iyer', 'viewer', 4, '9876500006', 'shrutii.ec23@rvce.edu.in'),
(7, 'amith_student', '$2a$10$NCMYgCUAz/VvBoUlSq3ZBeyIanMcTllHlKAtweW0RVaWd3xTJjXby', 'Amith N', 'viewer', 3, '9876500007', 'amithn.me22@rvce.edu.in');

-- ============================================================================
-- 3. Clubs Data
-- Real cultural/tech clubs from RVCE
-- ============================================================================
-- club_head_id must reference an existing user (NOT NULL FK). Seeded publishers are
-- users 1-4; non-demo clubs are headed by user 1 as a placeholder until reassigned.
INSERT IGNORE INTO clubs (id, name, code, club_head_id) VALUES
-- Technical clubs / teams
(1,  'Ashwa Racing', 'ASHWA', 1),
(2,  'Team Vyoma', 'VYOMA', 1),
(3,  'Team Chimera', 'CHIMERA', 1),
(4,  'Team Garuda', 'GARUDA', 1),
(5,  'Team Helios', 'HELIOS', 1),
(6,  'Solar Car Team', 'SOLAR', 1),
(7,  'Project Jatayu', 'JATAYU', 1),
(8,  'Team Astra', 'ASTRA', 1),
(9,  'Team Krushi', 'KRUSHI', 1),
(10, 'Team Antariksh', 'ANTARIKSH', 1),
(11, 'Frequency Club', 'FREQ', 1),
(12, 'Team Hydra', 'HYDRA', 1),
(13, 'Entrepreneurship Development Cell', 'EDC', 1),
(14, 'Coding Club', 'CODING', 4),
(15, 'Team Dhruva', 'DHRUVA', 1),
(16, 'RVCE HAM Club', 'HAM', 1),
(17, 'SPARK', 'SPARK', 1),
(18, 'Google Developer Groups', 'GDG', 1),
(19, 'Women in Cloud', 'WIC', 1),
(20, 'Accelerate Club', 'ACCEL', 1),
(21, 'Chitrak', 'CHITRAK', 1),
(22, 'Anoraniya', 'ANORANIYA', 1),
-- Non-technical / cultural clubs
(23, 'Avventura', 'AVVENTURA', 1),
(24, 'RV Debating Society', 'DEBSOC', 3),
(25, 'Raag', 'RAAG', 1),
(26, 'RV Quiz Corp', 'QUIZCORP', 1),
(27, 'Rotaract Club', 'ROTARACT', 1),
(28, 'Alaap', 'ALAAP', 1),
(29, 'Dance Club', 'DANCE', 1),
(30, 'Photography Club', 'PHOTO', 1),
(31, 'Literary Club', 'LITERARY', 1);

-- is_restricted deprecated: all communities are now public. Lock every row to FALSE.
UPDATE clubs SET is_restricted = FALSE;

-- ============================================================================
-- 4. Channels Data
-- Creating both department and club channels
-- ============================================================================
INSERT IGNORE INTO channels (id, type, department_id, club_id, name, description) VALUES
(1, 'department', 1, NULL, 'CSE Notice Board', 'Academic and lab schedules for Computer Science'),
(2, 'department', 3, NULL, 'Mechanical Bulletins', 'Workshop and CAD lab updates'),
(3, 'club', NULL, 24, 'DebSoc Discussions', 'Model UN and debate competition announcements'),
(4, 'club', NULL, 14, 'Coding Club Updates', 'Hackathons, game jams, and competitive programming events');

-- Backfill a community (channel) for every department that doesn't already have one.
-- This ensures all seeded departments are visible in the Communities section.
INSERT IGNORE INTO channels (type, department_id, name, description)
SELECT 'department', d.id, CONCAT(d.name, ' Notice Board'),
       CONCAT('Official announcements and updates for ', d.name)
FROM departments d
WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.department_id = d.id);

-- Backfill a community (channel) for every club that doesn't already have one.
INSERT IGNORE INTO channels (type, club_id, name, description)
SELECT 'club', cl.id, cl.name,
       COALESCE(cl.description, CONCAT('Updates and announcements from ', cl.name))
FROM clubs cl
WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.club_id = cl.id);

-- ============================================================================
-- 5. Subscriptions Data
-- ============================================================================
INSERT IGNORE INTO subscriptions (id, subscriber_id, channel_id, status) VALUES
(1, 5, 1, 'approved'), -- Bharath subscribes to CSE board
(2, 5, 4, 'approved'), -- Bharath subscribes to Envisage
(3, 6, 3, 'approved'), -- Shruti subscribes to Debsoc
(4, 7, 2, 'approved'), -- Amith subscribes to Mech board
(5, 7, 4, 'approved'); -- Amith joins Envisage (all communities are public now)

-- ============================================================================
-- 6. Posts Data
-- Using image_url (as updated in your schema)
-- ============================================================================
INSERT IGNORE INTO posts (id, publisher_id, channel_id, title, body, level, type, image_url, is_pinned, scheduled_at, expires_at) VALUES
-- Department Posts
(1, 1, 1, 'Update on DBMS Lab Evaluation', 'The final evaluation for the DBMS lab will be held next Tuesday. Bring your printed schemas.', 'department', 'circular', NULL, TRUE, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY)),
(2, 2, 2, 'CNC Machine Workshop', 'A mandatory 2-day workshop on the new 5-axis CNC machine in the main workshop floor.', 'department', 'workshop', '/uploads/cnc_poster.png', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY)),

-- Club Posts
(3, 3, 3, 'RV Asian Parliamentary Debate', 'Registrations are open for the annual RV APD tournament. Cash pool of Rs. 30,000!', 'student_body', 'event', '/uploads/apd_poster.png', TRUE, NOW(), DATE_ADD(NOW(), INTERVAL 10 DAY)),
(4, 4, 4, 'Unity 3D Game Jam', '48 hours to build a game. Theme will be announced on the spot. Pizza and Redbull on us.', 'club', 'hackathon', '/uploads/gamejam_poster.png', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 5 DAY)),

-- Coding Club Posts (posters from uploads)
(5, 4, 4, 'RV Code League', 'A beginner-friendly competitive programming event on HackerRank. No experience? No problem - just bring your curiosity! Winners get a spotlight on our social media. Venue: DTH (Offline), 4:30 PM to 6:30 PM. Scan the QR on the poster to register.', 'club', 'event', '/uploads/ig_rv_code_league.jpg', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 10 DAY)),
(6, 4, 4, 'Hackemon 2.0 - Catch The Flag', 'Catch the flag. Hack the system. Be the Pokemon master! A CTF event exclusively for 1st years with a prize pool of Rs. 6,000. Refreshments provided. Venue: DTH. Register soon!', 'club', 'hackathon', '/uploads/ig_hackemon.jpg', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY)),
(7, 4, 4, 'Cybersecurity Vertical presents tryhackme', 'The Cybersecurity Vertical of Coding Club RVCE brings you tryhackme - a new challenge every week with a cumulative leaderboard. Register at tryhackme.codingclubrvce.com and test your skills.', 'club', 'workshop', '/uploads/ig_cybersec_verticals.jpg', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY)),

-- CSE Department Posts (posters from uploads)
(8, 1, 1, '1st National Conference on Computer Vision - NCCV 2026', 'Theme: Surveillance & Beyond "The CCTV Story". Organised in association with the Center of Excellence in Computer Vision Research at RVCE. Keynote talks, tutorials, workshops, research paper presentations, hackathons and an industry expo. Dates: August 6th and 7th. Tracks include Analytics & AI, Security & Surveillance, Hardware & Projects, and Governance. An award is instituted for the Best Research Paper.', 'department', 'conference', '/uploads/ig_cv_conference.jpg', TRUE, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY)),
(9, 1, 1, 'IEEE WIE Innovate & Inspire Poster Contest', 'WIE, IEEE India Council in collaboration with the Delhi and Bangalore Sections presents the Innovate & Inspire Poster Contest - empowering women to shape technology for a better world. Mode: Online. Open to IEEE and non-IEEE students. Prizes include First, Second and a Best Creative Poster Award. Unleash your creativity and inspire the world!', 'department', 'event', '/uploads/ig_ieee_wie_day.jpg', FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY));

-- ============================================================================
-- 7. Likes Data
-- Students liking the Game Jam and Debate posts
-- ============================================================================
INSERT IGNORE INTO likes (id, user_id, post_id) VALUES
(1, 5, 4), -- Bharath liked the Unity 3D Game Jam
(2, 6, 3), -- Shruti liked the Debate tournament
(3, 7, 4), -- Amith liked the Unity 3D Game Jam
(4, 7, 2); -- Amith liked the CNC workshop

-- ============================================================================
-- 8. Bookmarks Data
-- Students saving important lab/workshop notices for later
-- ============================================================================
INSERT IGNORE INTO bookmarks (id, user_id, post_id) VALUES
(1, 5, 1), -- Bharath bookmarked the DBMS lab notice
(2, 7, 2), -- Amith bookmarked the CNC Workshop
(3, 6, 3); -- Shruti bookmarked the Debate tournament

-- ============================================================================
-- 9. Stories Data
-- Temporary 24-hour visual updates by Club Heads/Publishers
-- ============================================================================
INSERT IGNORE INTO stories (id, publisher_id, media_url, caption, expires_at) VALUES
(1, 3, '/uploads/story_debsoc.png', 'Setting up the auditoriums for the finals! 🎤', DATE_ADD(NOW(), INTERVAL 24 HOUR)),
(2, 4, '/uploads/story_vr.png', 'New Meta Quest 3 headsets just arrived at the lab! 😎', DATE_ADD(NOW(), INTERVAL 12 HOUR)),
(3, 1, '/uploads/story_cse.png', 'Reminder: Bring your ID cards to the DBMS lab tomorrow.', DATE_ADD(NOW(), INTERVAL 6 HOUR));
