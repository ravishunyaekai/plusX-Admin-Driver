import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../../config/db.js';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { formatDateTimeInQuery, generateRandomPassword } from '../../utils.js';
dotenv.config();

var transporter = nodemailer.createTransport({
    host : process.env.MAIL_HOST,
    port : process.env.MAIL_PORT,
    auth : {
        user : process.env.MAIL_USERNAME,
        pass : process.env.MAIL_PASSWORD
    }
});
export const login = async(req, resp) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.execute(`SELECT id, name, email, phone, image, department_id, ${formatDateTimeInQuery(['created_at', 'updated_at'])}, password FROM users WHERE email=?`, [email]);
        if(users.length === 0){ 
            return resp.status(200).json({message: "Invalid email "}); 
        }
        const user    = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return resp.status(200).json({ message: 'Invalid password' });
        }
        await db.execute('UPDATE users SET status = 1 WHERE email = ?', [email]);
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
      
        resp.cookie('authToken', token, { 
            httpOnly : true,   
            //secure : false,
            secure   : process.env.NODE_ENV === 'production', 
            sameSite : 'None',
            maxAge   : 3600000 
        });
        resp.status(200).json({
            message     : "Login successfull",
            code        : 200, 
            userDetails : users[0], 
            base_url    : `${process.env.DIR_UPLOADS}profile-image/`,
            Token       : process.env.CUSTOM_TOKEN
        }) 
    } catch (error) {
      console.error("Database query error:", error);
      resp.status(500).json({
        message     : error,
        code        : 500, 
        userDetails : {}, 
        base_url    : `${process.env.DIR_UPLOADS}profile-image/`,
        Token       : ''
    }) 
    }
};

export const logout = async (req, resp) => {
    const { email } = req.body;
    
    if (!email) {
        return resp.json({ status : 0, message: "Email is required." });
    }
    try {
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0) {
            return resp.json({ status : 0, message: "User not found." });
        }
        await db.execute('UPDATE users SET status = 0 WHERE email = ?', [email]);

        return resp.json({ status : 1, message: "Logged out successfully." });
    } catch (error) {
        console.error("Error during logout:", error);
        return resp.json({ status : 0, message: "Logout failed." });
    }
};

export const forgotPassword = async (req, resp) => {
    const { email } = req.body;
  
    const [users] = await db.execute('SELECT * FROM users WHERE email=?', [email]);
    if (users.length === 0) {
      return resp.status(404).json({ message: "Entered email is not registered with us, try with another one" });
    }
  
    const user = users[0];
    const pswd = generateRandomPassword();
    const hashedPswd = await bcrypt.hash(pswd, 10);

    await db.execute('UPDATE users SET password=? WHERE id=?', [hashedPswd, user.id]);
  
    try {
      await transporter.sendMail({
        from: `"Easylease Admin" <admin@easylease.com>`,
        to: email,
        subject: 'Forgot password Request',
        html: `
          <html>
            <body>
              <h4>Hello ${user.name},</h4>
              <p>We have received a request for a forgotten password. So we are sharing one random password here, with this password you can log in to your Easylease account.</p>
              <p>Password - <b>${pswd}</b></p>
              <p>Note: For security and your convenience, we recommend that you change your password once you log in to your account.</p>
              <br/>
              <p>Regards,<br/>Easylease Admin Team</p>
            </body>
          </html>
        `,
      });
  
      resp.status(200).json({ message: "An email has been sent to your entered registered email address. Please check that!" });
    } catch (error) {
      resp.status(500).json({ message: "Failed to send email." });
    }
};

export const updatePassword = async (req, resp) => {
  
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword) {
      return resp.status(400).json({ message: "Email, current password, and new password are required." });
  }

  try {
      const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
      
      if (users.length === 0) {
          return resp.status(404).json({ message: "Entered email is not registered with us, try with another one." });
      }

      const user = users[0];

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      
      if (!isMatch) {
          return resp.status(401).json({ message: "Current password is incorrect." });
      }

      const hashedPswd = await bcrypt.hash(newPassword, 10);

      await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPswd, user.id]);

      resp.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
      console.error("Error updating password:", error);
      resp.status(500).json({ message: "Failed to update password." });
  }
};
