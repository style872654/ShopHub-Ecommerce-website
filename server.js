require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shopHub', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  console.log('Server will continue to run without database functionality');
});

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Email Configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Test email configuration
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Forgot Password Route
app.post('/api/forgot-password', async (req, res) => {
  try {
    console.log('Received forgot password request:', req.body);
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user by email
    let user = await User.findOne({ email });
    
    // If user doesn't exist, create a new account
    if (!user) {
      console.log('Creating new account for:', email);
      // Generate a random temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex');
      
      // Create new user
      user = new User({
        email,
        password: tempPassword, // In a real app, this should be hashed
        createdAt: new Date()
      });
      
      // Save the new user
      await user.save();
      
      // Send welcome email with temporary password
      const welcomeMailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Welcome to ShopHub - Your Account Details',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3b82f6; margin-bottom: 20px;">Welcome to ShopHub!</h2>
            <p>We've created an account for you with the following details:</p>
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Temporary Password:</strong> ${tempPassword}</p>
            </div>
            <p style="color: #ef4444; font-weight: bold;">For security reasons, please change your password immediately after logging in.</p>
            <div style="margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/login.html" 
                 style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Log in to your account
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px;">
              If you didn't request this account, please ignore this email or contact our support team.
            </p>
          </div>
        `
      };
      
      await transporter.sendMail(welcomeMailOptions);
      console.log('Welcome email sent successfully');
      
      return res.json({ 
        message: 'Account created successfully. Please check your email for login details.',
        isNewAccount: true 
      });
    }

    // For existing users, proceed with password reset
    console.log('Processing password reset for:', email);
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request - ShopHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Request</h2>
          <p>You requested a password reset for your ShopHub account.</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
          </div>
          <div style="margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Your Password
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            This link will expire in 1 hour.<br>
            If you didn't request this password reset, please ignore this email or contact our support team.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Reset email sent successfully');

    res.json({ 
      message: 'Password reset email sent successfully',
      isNewAccount: false
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      message: 'Error processing request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Reset Password Route
app.post('/api/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    // Hash token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Update password
    user.password = password; // In a real app, this should be hashed
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    // Send confirmation email
    const confirmationMailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Successful - ShopHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Successful</h2>
          <p>Your password has been successfully reset for your ShopHub account.</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${user.email}</p>
          </div>
          <div style="margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/login.html" 
               style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Log in to your account
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            If you didn't make this change, please contact our support team immediately.
          </p>
        </div>
      `
    };

    await transporter.sendMail(confirmationMailOptions);
    console.log('Password reset confirmation email sent');

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

// Login Route
app.post('/api/login', async (req, res) => {
  try {
    console.log('Received login request:', req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // In a real app, you would hash the password and compare hashes
    // For demo purposes, we're doing a direct comparison
    if (user.password !== password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Login successful
    console.log('User logged in successfully:', email);

    // In a real app, you would:
    // 1. Generate a JWT token
    // 2. Set up a session
    // 3. Set secure cookies
    res.json({ 
      message: 'Login successful',
      user: {
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: 'Error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Send Reset Email Route
app.post('/api/send-reset-email', async (req, res) => {
  try {
    const { email, resetUrl } = req.body;
    console.log('Sending reset email to:', email);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request - ShopHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Request</h2>
          <p>You requested a password reset for your ShopHub account.</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
          </div>
          <div style="margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Your Password
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            This link will expire in 1 hour.<br>
            If you didn't request this password reset, please ignore this email or contact our support team.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Reset email sent successfully');

    res.json({ message: 'Reset email sent successfully' });
  } catch (error) {
    console.error('Send reset email error:', error);
    res.status(500).json({ 
      message: 'Error sending reset email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  image: { type: String, required: true },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// Product API Routes
app.get('/api/products', async (req, res) => {
  try {
    const { search, category, sort, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    // Apply search filter
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { sku: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    // Apply category filter
    if (category) {
      query.category = category;
    }
    
    // Build sort options
    let sortOptions = {};
    if (sort) {
      switch (sort) {
        case 'name-asc':
          sortOptions = { name: 1 };
          break;
        case 'name-desc':
          sortOptions = { name: -1 };
          break;
        case 'price-asc':
          sortOptions = { price: 1 };
          break;
        case 'price-desc':
          sortOptions = { price: -1 };
          break;
        case 'date-desc':
          sortOptions = { createdAt: -1 };
          break;
        case 'date-asc':
          sortOptions = { createdAt: 1 };
          break;
        default:
          sortOptions = { createdAt: -1 };
      }
    } else {
      sortOptions = { createdAt: -1 };
    }
    
    // Execute query with pagination
    const products = await Product.find(query)
      .sort(sortOptions)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalProducts = await Product.countDocuments(query);
    
    res.json({
      products,
      totalPages: Math.ceil(totalProducts / parseInt(limit)),
      currentPage: parseInt(page),
      totalProducts
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ 
      message: 'Error retrieving products',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const productData = req.body;
    
    // Validate required fields
    if (!productData.name || !productData.category || !productData.price || !productData.image) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Create new product
    const product = new Product({
      ...productData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await product.save();
    
    res.status(201).json({ 
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ 
      message: 'Error creating product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ 
      message: 'Error retrieving product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productData = req.body;
    
    // Validate required fields
    if (!productData.name || !productData.category || !productData.price || !productData.image) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Find and update product
    const product = await Product.findByIdAndUpdate(
      id,
      {
        ...productData,
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json({ 
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ 
      message: 'Error updating product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findByIdAndDelete(id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json({ 
      message: 'Product deleted successfully',
      productId: id
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ 
      message: 'Error deleting product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Serve static files from the root directory
app.use(express.static('./'));

// Serve the main index.html file for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the specific HTML pages for their routes
app.get('/:page', (req, res) => {
  const page = req.params.page;
  res.sendFile(path.join(__dirname, `${page}.html`));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
