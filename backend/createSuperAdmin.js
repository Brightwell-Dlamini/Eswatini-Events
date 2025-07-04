require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('DB connection failed:', err);
    process.exit(1);
  });

async function createSuperAdmin() {
  try {
    // Get credentials interactively
    readline.question('Enter admin email: ', async (email) => {
      readline.question('Enter admin password: ', async (password) => {
        // Validation
        if (!email || !password) {
          console.error('Email and password are required!');
          process.exit(1);
        }

        // Check if already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          console.error('User already exists!');
          process.exit(1);
        }

        // Create the super admin
        const hashedPassword = await bcrypt.hash(password, 12);
        await User.create({
          email,
          password: hashedPassword,
          role: 'super_admin',
          name: 'System Owner',
        });

        console.log('\x1b[32m%s\x1b[0m', '✔ Super admin created successfully!');
        console.log(`Email: ${email}`);
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', '✖ Error:', err.message);
    process.exit(1);
  }
}

createSuperAdmin();
