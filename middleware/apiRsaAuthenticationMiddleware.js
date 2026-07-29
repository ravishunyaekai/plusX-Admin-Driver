import db from "../config/db.js";
import { mergeParam } from "../utils.js";

export const apiRsaAuthentication = async (req, resp, next) => {
  try{
    const {rsa_id} = mergeParam(req);
    const token = req.headers["accesstoken"];
    const rsaId = rsa_id;
    // console.log(req.body, 'Ravv')
    if (!token) {
      return resp.status(401).json({ message: 'Access token is missing', code: 400, data: {}, status:0 });
    }

    if (!rsaId || rsaId.trim() === '') {
      return resp.status(400).json({ message: 'Rsa ID is missing', code: 400, data: {}, status: 0 });
    }
    
    const [rows] = await db.execute('SELECT * FROM rsa WHERE rsa_id = ? AND access_token = ?', [rsaId, token]);
    if (rows.length === 0) {
      return resp.status(401).json({ message: 'Access Denied. Invalid Access Token key', code: 400, data: {}, status:0 });
    }
  
    next();
  } catch (error) {
    console.error('Database error:', error.message || error);
    return resp.status(500).json({message: 'Internal Server Error',code: 500,data: {},status: 0,});
  }
};
