import multer from 'multer';
import path from 'path';
import { uploadFileToS3WithDetails } from '../../fileUpload.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const ALLOWED_TYPES = ['pdf', 'png', 'jpeg', 'jpg', 'webp', 'gif', 'mp4', 'csv', 'xlsx', 'xls', 'doc', 'docx'];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
        return cb(new Error(`Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`), false);
    }
    cb(null, true);
};

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter,
});

/** Multer middleware — form-data field name must be "file" */
export const uploadFileMiddleware = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            const message = err instanceof multer.MulterError
                ? (err.code === 'LIMIT_FILE_SIZE' ? 'File size should not exceed 10 MB.' : err.message)
                : err.message;
            return res.json({ status: 0, code: 422, message: [message] });
        }
        next();
    });
};

/**
 * Upload a file to S3 and return the public URL.
 * Copy s3_url / url into response_module manually after upload.
 *
 * Default path: uploads/banner/{filename}
 *
 * Postman:
 *   POST /admin/upload-file
 *   Header: Authorization = API_AUTH_KEY
 *   Body: form-data
 *     - file   (File)   required
 *     - folder (Text)   optional, default "banner"
 */
export const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.json({
                status  : 0,
                code    : 422,
                message : ['File is required. In Postman use form-data key: file'],
            });
        }

        // Default folder: banner → S3 path = uploads/banner/{filename}
        const rawFolder = (req.body.folder || 'banner').trim();
        const folder    = rawFolder.replace(/[^a-zA-Z0-9_-]/g, '') || 'banner';

        const result = await uploadFileToS3WithDetails(req.file, folder);

        return res.json({
            status  : 1,
            code    : 200,
            message : 'File uploaded successfully. Copy s3_url into response_module manually.',
            data    : {
                original_name : req.file.originalname,
                file_name     : result.fileName,
                folder,
                s3_key        : result.key,
                s3_url        : result.s3_url, // AWS Location
                url           : result.url,    // DIR_UPLOADS style (same pattern as other APIs)
            },
        });
    } catch (error) {
        console.error('Upload file error:', error);
        tryCatchErrorHandler(req.originalUrl, error, res);
    }
};
