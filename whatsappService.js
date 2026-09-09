import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_MEDIA = path.join(__dirname, 'assets', 'whatsapp', 'template-28.jpg');

const normalizeWhatsAppNumber = (countryCode, mobile) => {
    const normalizedCountryCode = String(countryCode || '').replace(/\D/g, '');
    let normalizedMobile = String(mobile || '').replace(/\D/g, '');

    if (normalizedMobile.startsWith('00')) {
        normalizedMobile = normalizedMobile.substring(2);
    }

    if (normalizedCountryCode && !normalizedMobile.startsWith(normalizedCountryCode)) {
        normalizedMobile = `${normalizedCountryCode}${normalizedMobile.replace(/^0+/, '')}`;
    }

    if (!/^\d{8,15}$/.test(normalizedMobile)) {
        throw new Error('Invalid WhatsApp recipient number');
    }

    return normalizedMobile;
};

const resolveExtension = (filePathOrUrl, fallback = 'jpg') => {
    const clean = String(filePathOrUrl || '').split('?')[0];
    const ext = path.extname(clean).replace('.', '').toLowerCase();
    if (!ext) return fallback;
    return ext === 'jpeg' ? 'jpg' : ext;
};

const resolveTemplateMedia = async () => {
    const {
        WHATSAPP_TEMPLATE_MEDIA_PATH,
        WHATSAPP_TEMPLATE_MEDIA_URL,
    } = process.env;

    if (WHATSAPP_TEMPLATE_MEDIA_PATH) {
        const configuredPath = path.isAbsolute(WHATSAPP_TEMPLATE_MEDIA_PATH)
            ? WHATSAPP_TEMPLATE_MEDIA_PATH
            : path.resolve(__dirname, WHATSAPP_TEMPLATE_MEDIA_PATH);
        if (!fs.existsSync(configuredPath)) {
            throw new Error(`WhatsApp template media not found at WHATSAPP_TEMPLATE_MEDIA_PATH: ${configuredPath}`);
        }
        return {
            filePath  : configuredPath,
            extension : resolveExtension(configuredPath),
            cleanup   : null,
        };
    }

    if (WHATSAPP_TEMPLATE_MEDIA_URL) {
        const extension = resolveExtension(WHATSAPP_TEMPLATE_MEDIA_URL);
        const tmpPath = path.join(os.tmpdir(), `wa-template-${Date.now()}.${extension}`);
        const response = await axios.get(WHATSAPP_TEMPLATE_MEDIA_URL, {
            responseType : 'arraybuffer',
            timeout      : 20000,
        });
        fs.writeFileSync(tmpPath, response.data);
        return {
            filePath  : tmpPath,
            extension,
            cleanup   : () => {
                try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            },
        };
    }

    if (fs.existsSync(DEFAULT_TEMPLATE_MEDIA)) {
        return {
            filePath  : DEFAULT_TEMPLATE_MEDIA,
            extension : resolveExtension(DEFAULT_TEMPLATE_MEDIA),
            cleanup   : null,
        };
    }

    throw new Error('Missing WhatsApp template media: set WHATSAPP_TEMPLATE_MEDIA_PATH or WHATSAPP_TEMPLATE_MEDIA_URL');
};

/**
 * Send WhatsApp template via MessageBot Public API.
 * Template 28 is an Image template with no body variables — Sample is optional.
 */
export const sendAppDownloadWhatsApp = async ({
    customerName,
    countryCode,
    mobile,
    campaignName,
    sample,
} = {}) => {
    const {
        WHATSAPP_API_TOKEN,
        WHATSAPP_TEMPLATE_ID,
        WHATSAPP_API_BASE_URL = 'https://papi.messagebot.in',
        WHATSAPP_SAMPLE,
        WHATSAPP_CAMPAIGN_NAME = 'RSA_Offline_Booking',
    } = process.env;

    const requiredConfig = {
        WHATSAPP_API_TOKEN,
        WHATSAPP_TEMPLATE_ID,
    };
    const missingConfig = Object.entries(requiredConfig)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missingConfig.length) {
        throw new Error(`Missing WhatsApp configuration: ${missingConfig.join(', ')}`);
    }

    const recipient = normalizeWhatsAppNumber(countryCode, mobile);
    const media = await resolveTemplateMedia();

    try {
        const form = new FormData();
        form.append('ApiToken', WHATSAPP_API_TOKEN.trim());
        form.append('TemplateId', String(WHATSAPP_TEMPLATE_ID).trim());
        form.append('QuickNumber', recipient);
        form.append(
            'CampaignName',
            (campaignName || WHATSAPP_CAMPAIGN_NAME || 'RSA_Offline_Booking').toString().slice(0, 100)
        );
        form.append('TemplateFile', fs.createReadStream(media.filePath), {
            filename : path.basename(media.filePath),
        });
        form.append('TemplateFileExtension', media.extension);

        // Only send Sample when template has placeholders (current template 28 has none).
        const sampleValue = sample ?? WHATSAPP_SAMPLE;
        if (sampleValue !== undefined && sampleValue !== null && String(sampleValue).trim() !== '') {
            form.append('Sample', String(sampleValue).trim());
        }

        const url = `${String(WHATSAPP_API_BASE_URL).replace(/\/$/, '')}/whatsapp/SendMessage`;
        const response = await axios.post(url, form, {
            headers          : form.getHeaders(),
            timeout          : 30000,
            maxBodyLength    : Infinity,
            maxContentLength : Infinity,
        });

        const data = response.data || {};
        const isSuccess = data.IsSuccess ?? data.isSuccess;
        const errorDescription = data.ErrorDescription || data.errorDescription || null;
        const campaignId = data.ReturnData ?? data.returnData ?? null;

        // MessageBot returns IsSuccess=true with ErrorCode 40 ("Message Accepted").
        if (!isSuccess) {
            throw new Error(errorDescription || 'WhatsApp send failed');
        }

        return {
            recipient,
            campaignId,
            customerName : customerName || null,
            errorCode  : data.ErrorCode ?? data.errorCode ?? null,
            description: errorDescription,
        };
    } finally {
        if (typeof media.cleanup === 'function') {
            media.cleanup();
        }
    }
};
