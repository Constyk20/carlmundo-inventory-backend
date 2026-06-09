require('dotenv').config();
const readline = require('readline');
const mongoose = require('mongoose');
const User = require('../models/User');
const { ROLES, ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');

// ─── Helpers ───────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));

/** Ask for a password without echoing characters to the terminal */
const askPassword = (question) =>
  new Promise((resolve) => {
    // Write the prompt manually so we can control output
    process.stdout.write(question);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    const onData = (ch) => {
      switch (ch) {
        case '\u0003': // Ctrl-C
          process.stdout.write('\n');
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.exit(0);
          break;

        case '\r':    // Enter (CR)
        case '\n':    // Enter (LF)
          process.stdout.write('\n');
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          resolve(password);
          break;

        case '\u007f': // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b'); // erase last dot
          }
          break;

        default:
          password += ch;
          process.stdout.write('*'); // mask input
      }
    };

    stdin.on('data', onData);
  });

const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);

/**
 * Password must be ≥ 8 chars, contain uppercase, lowercase,
 * a digit, and a special character — matches the Joi schema in validate.js.
 */
const isStrongPassword = (pw) =>
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[@$!%*?&#^()\-_=+[\]{};:'",.<>/?\\|`~]/.test(pw);

// ─── Main ──────────────────────────────────────────────────────────────────

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('\n✅ Connected to MongoDB\n');

    // ── Check for existing admin ───────────────────────────────────────────
    const adminExists = await User.findOne({ role: ROLES.ADMIN, isDeleted: false });
    if (adminExists) {
      console.log(`ℹ️  An admin account already exists: ${adminExists.email}`);
      console.log('   Run the app and use the admin panel to manage users.\n');
      rl.close();
      process.exit(0);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Create Initial Admin Account');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ── Collect name ──────────────────────────────────────────────────────
    let name = '';
    while (!name) {
      name = await ask('Full name: ');
      if (name.length < 2) {
        console.log('  ⚠ Name must be at least 2 characters.\n');
        name = '';
      }
    }

    // ── Collect email ─────────────────────────────────────────────────────
    let email = '';
    while (!email) {
      email = (await ask('Email address: ')).toLowerCase();
      if (!isValidEmail(email)) {
        console.log('  ⚠ Please enter a valid email address.\n');
        email = '';
        continue;
      }
      const taken = await User.findOne({ email });
      if (taken) {
        console.log('  ⚠ That email is already registered.\n');
        email = '';
      }
    }

    // ── Collect password ──────────────────────────────────────────────────
    let password = '';
    while (!password) {
      password = await askPassword('Password: ');
      if (!isStrongPassword(password)) {
        console.log(
          '\n  ⚠ Password must be at least 8 characters and include:\n' +
          '    • an uppercase letter\n' +
          '    • a lowercase letter\n' +
          '    • a number\n' +
          '    • a special character (e.g. @$!%*?&)\n'
        );
        password = '';
        continue;
      }

      const confirm = await askPassword('Confirm password: ');
      if (password !== confirm) {
        console.log('\n  ⚠ Passwords do not match. Try again.\n');
        password = '';
      }
    }

    rl.close();

    // ── Create admin ───────────────────────────────────────────────────────
    console.log('\n  Creating admin account…');

    const admin = await User.create({
      name,
      email,
      password,
      role:        ROLES.ADMIN,
      permissions: ROLE_DEFAULT_PERMISSIONS[ROLES.ADMIN],
      isActive:    true,
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ Admin account created successfully!');
    console.log(`     Name  : ${admin.name}`);
    console.log(`     Email : ${admin.email}`);
    console.log(`     Role  : ${admin.role}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (err) {
    rl.close();
    console.error('\n❌ Seeder error:', err.message || err);
    process.exit(1);
  }
};

seedAdmin();
