import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import { IdVerificationController } from '../controllers/idVerification.controller';

const router = Router();

// Ensure temporary uploads directory exists
const tempUploadDir = path.join(__dirname, '../../uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Multer temporary disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `id-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 2, // front and back
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are permitted for ID capture.'));
    }
  },
});

// Rate limiting for ID verification endpoints
const verificationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { message: 'Too many ID verification requests. Please try again shortly.', code: 'rate_limit_exceeded' },
});

router.use(verificationLimiter);

// 1. Create verification session
router.post(
  '/sessions',
  [
    body('selectedIdType').notEmpty().withMessage('Selected ID type is required'),
    body('issuingCountry').notEmpty().withMessage('Issuing country is required'),
    body('consentGiven').isBoolean().withMessage('Consent must be explicitly declared as true or false'),
  ],
  validate,
  IdVerificationController.createSession
);

// 2. Upload document images (front and back)
router.post(
  '/:sessionId/document',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ]),
  IdVerificationController.uploadDocument
);

// 3. Process OCR and authenticity checks
router.post('/:sessionId/process', IdVerificationController.processDocument);

// 4. Retrieve session status
router.get('/:sessionId', IdVerificationController.getSession);

// 5. Correct extracted fields
router.post('/:sessionId/correct', IdVerificationController.correctFields);

// 6. Authorized staff manual review override
router.post(
  '/:sessionId/staff-review',
  [
    body('staffId').notEmpty().withMessage('Staff ID is required'),
    body('staffPin').notEmpty().withMessage('Staff PIN is required'),
    body('decision').isIn(['approved', 'rejected']).withMessage('Decision must be "approved" or "rejected"'),
    body('physicalOriginalInspected').optional().isBoolean().withMessage('physicalOriginalInspected must be a boolean'),
  ],
  validate,
  IdVerificationController.staffReview
);

// 7. Cancel session and purge temporary files
router.post('/:sessionId/cancel', IdVerificationController.cancelSession);

export default router;
