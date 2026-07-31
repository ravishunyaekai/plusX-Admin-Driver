import axios from 'axios';

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

export const sendAppDownloadWhatsApp = async ({ customerName, countryCode, mobile }) => {
    const {
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID,
        WHATSAPP_API_VERSION,
        WHATSAPP_APP_DOWNLOAD_TEMPLATE,
        WHATSAPP_TEMPLATE_LANGUAGE = 'en',
        PLAY_STORE_APP_URL,
        APP_STORE_APP_URL,
    } = process.env;

    const requiredConfig = {
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID,
        WHATSAPP_API_VERSION,
        WHATSAPP_APP_DOWNLOAD_TEMPLATE,
        PLAY_STORE_APP_URL,
        APP_STORE_APP_URL,
    };
    const missingConfig = Object.entries(requiredConfig)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missingConfig.length) {
        throw new Error(`Missing WhatsApp configuration: ${missingConfig.join(', ')}`);
    }

    const recipient = normalizeWhatsAppNumber(countryCode, mobile);
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await axios.post(url, {
        messaging_product : 'whatsapp',
        recipient_type    : 'individual',
        to                : recipient,
        type              : 'template',
        template          : {
            name     : WHATSAPP_APP_DOWNLOAD_TEMPLATE,
            language : { code: WHATSAPP_TEMPLATE_LANGUAGE },
            components: [{
                type       : 'body',
                parameters : [
                    { type: 'text', text: customerName || 'Customer' },
                    { type: 'text', text: PLAY_STORE_APP_URL },
                    { type: 'text', text: APP_STORE_APP_URL },
                ],
            }],
        },
    }, {
        headers: {
            Authorization  : `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type' : 'application/json',
        },
        timeout: 10000,
    });

    return {
        recipient,
        messageId: response.data?.messages?.[0]?.id || null,
    };
};
