import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryDB, updateRecord } from './dbUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WHATSAPP_SEND_PATH = '/whatsapp/SendMessage';
const WHATSAPP_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_CAMPAIGN_NAME = 'RSA_Offline_Booking';

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

const resolveExtension = (filePath, fallback = 'jpg') => {
    const ext = path.extname(String(filePath || '')).replace('.', '').toLowerCase();
    if (!ext) return fallback;
    return ext === 'jpeg' ? 'jpg' : ext;
};

const resolveTemplateMedia = () => {
    const { WHATSAPP_TEMPLATE_MEDIA_PATH } = process.env;

    if (!WHATSAPP_TEMPLATE_MEDIA_PATH) {
        throw new Error('Missing WhatsApp configuration: WHATSAPP_TEMPLATE_MEDIA_PATH');
    }

    const configuredPath = path.isAbsolute(WHATSAPP_TEMPLATE_MEDIA_PATH)
        ? WHATSAPP_TEMPLATE_MEDIA_PATH
        : path.resolve(__dirname, WHATSAPP_TEMPLATE_MEDIA_PATH);

    if (!fs.existsSync(configuredPath)) {
        throw new Error(`WhatsApp template media not found at WHATSAPP_TEMPLATE_MEDIA_PATH: ${configuredPath}`);
    }

    return {
        filePath  : configuredPath,
        extension : resolveExtension(configuredPath),
    };
};

/**
 * Send WhatsApp template via MessageBot Public API.
 * Env required: WHATSAPP_API_TOKEN, WHATSAPP_TEMPLATE_ID,
 * WHATSAPP_API_BASE_URL, WHATSAPP_TEMPLATE_MEDIA_PATH
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
        WHATSAPP_API_BASE_URL,
    } = process.env;

    const requiredConfig = {
        WHATSAPP_API_TOKEN,
        WHATSAPP_TEMPLATE_ID,
        WHATSAPP_API_BASE_URL,
    };
    const missingConfig = Object.entries(requiredConfig)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missingConfig.length) {
        throw new Error(`Missing WhatsApp configuration: ${missingConfig.join(', ')}`);
    }

    const recipient = normalizeWhatsAppNumber(countryCode, mobile);
    const media = resolveTemplateMedia();

    const form = new FormData();
    form.append('ApiToken', WHATSAPP_API_TOKEN.trim());
    form.append('TemplateId', String(WHATSAPP_TEMPLATE_ID).trim());
    form.append('QuickNumber', recipient);
    form.append(
        'CampaignName',
        (campaignName || DEFAULT_CAMPAIGN_NAME).toString().slice(0, 100)
    );
    form.append('TemplateFile', fs.createReadStream(media.filePath), {
        filename : path.basename(media.filePath),
    });
    form.append('TemplateFileExtension', media.extension);

    // Only send Sample when template has placeholders (current template 28 has none).
    if (sample !== undefined && sample !== null && String(sample).trim() !== '') {
        form.append('Sample', String(sample).trim());
    }

    const baseUrl = String(WHATSAPP_API_BASE_URL).replace(/\/$/, '');
    const url = `${baseUrl}${WHATSAPP_SEND_PATH}`;

    const response = await axios.post(url, form, {
        headers          : form.getHeaders(),
        timeout          : WHATSAPP_REQUEST_TIMEOUT_MS,
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
};

/**
 * Send WhatsApp once per mobile within a single module table.
 * RSA offline and charger inquiry are independent — each table has its own whatsapp_sent flag.
 */
export const sendAppDownloadWhatsAppOnceByMobile = async ({
    tableName,
    recordIdField,
    recordId,
    customerName,
    countryCode,
    mobile,
    campaignName,
    sample,
} = {}) => {
    if (!tableName || !recordIdField || !recordId) {
        throw new Error('tableName, recordIdField and recordId are required');
    }

    const existing = await queryDB(
        `SELECT ${recordIdField} AS record_id, whatsapp_campaign_id
         FROM ${tableName}
         WHERE mobile_no = ? AND whatsapp_sent = 1
         LIMIT 1`,
        [mobile]
    );

    if (existing) {
        return {
            skipped    : true,
            status     : 'already_sent',
            campaignId : existing.whatsapp_campaign_id || null,
            customerName: customerName || null,
            recordId   : existing.record_id || null,
        };
    }

    const result = await sendAppDownloadWhatsApp({
        customerName,
        countryCode,
        mobile,
        campaignName,
        sample,
    });

    await updateRecord(tableName, {
        whatsapp_sent        : 1,
        whatsapp_campaign_id : result.campaignId != null ? String(result.campaignId) : null,
    }, [recordIdField], [recordId]);

    return {
        skipped : false,
        status  : 'accepted',
        ...result,
    };
};
