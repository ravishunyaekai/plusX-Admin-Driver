
import axios from "axios";
import path from 'path';
import { insertRecord } from "./dbUtils.js";
import dotenv from 'dotenv';

dotenv.config();
import { deleteImageFromS3 } from "./fileUpload.js";

export function mergeParam(req) {
  return { ...req.query, ...req.body };
};

export const generateRandomPassword = (length = 8) => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    password += chars[randomIndex];
  }
  return password;
};
const formatTime = (timeStr) => {
    const [hour, minute, second] = timeStr.split(':').map(Number);
    const isPM = hour >= 12;
    const adjustedHour = hour % 12 === 0 ? 12 : hour % 12;
    const period = isPM ? 'PM' : 'AM';

    return `${adjustedHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${period}`;
};
/* Format Timings */
export const getOpenAndCloseTimings = (data) => {
    const dayTime = [];

    if (data.always_open === 0) { //formatTime
        const openDays      = data.open_days.split(',').map(day => day.trim());
        const openTimings   = data.open_timing.split(',').map(time => time.trim());
        const uniqueTimings = [...new Set(openTimings)];

        if (uniqueTimings.length !== openTimings.length) {
            uniqueTimings.forEach((timing) => {
                const keys = openTimings.reduce((acc, curr, index) => {
                    if (curr === timing) acc.push(index);
                    return acc;
                }, []);
                let start = '';
                let end = '';
                let formattedTiming = 'Closed';

                if (timing !== 'Closed') {
                    const times = timing.split('-');
                    const startTime = formatTime(times[0]);
                    const endTime = formatTime(times[1]);
                    formattedTiming = `${startTime}-${endTime}`;
                }

                for (let i = 0; i < keys.length; i++) {
                    start = (start === '') ? openDays[keys[i]] : start;

                    if (keys[i + 1] && (keys[i + 1] - keys[i] !== 1 && i + 1 !== keys.length)) {
                        end = openDays[keys[i]];
                        const days = start === end ? end : `${start}-${end}`;
                        dayTime.push({ days, time: formattedTiming, position: keys[i] });
                        start = '';
                    }

                    if (i + 1 === keys.length) {
                        end = openDays[keys[i]];
                        const days = start === end ? end : `${start}-${end}`;
                        dayTime.push({ days, time: formattedTiming, position: keys[i] });
                    }
                }
            });
        }
        else if (openDays.length === openTimings.length){

            openDays.map((item, index) => {
                console.log(index, item);

                const times = openTimings[index].split('-');
                const startTime = formatTime(times[0]);
                const endTime = formatTime(times[1]);
                const formattedTiming = `${startTime}-${endTime}`;

                dayTime.push({ days : item, time: formattedTiming, position: index });
            });            
        }
        dayTime.sort((a, b) => a.position - b.position);

        return dayTime;
    } else {
        return [{ days: 'Always Open', time: '' }];
    }
};

export const formatOpenAndCloseTimings = (alwaysOpen, data) => {
    if (!alwaysOpen) return { fDays: '', fTiming: '' };

    const days  = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday' ];
    const fDays = days.join('_');

    const timeArr = days.map(day => { 
        const openTime = data[`${day}_open_time`];
        const closeTime = data[`${day}_close_time`];

        if (openTime && closeTime && openTime !== 'undefined' && closeTime !== 'undefined') {

            const formattedOpenTime = new Date(`1970-01-01T${openTime}`).toTimeString().slice(0, 8);
            const formattedCloseTime = new Date(`1970-01-01T${closeTime}`).toTimeString().slice(0, 8);
            return `${formattedOpenTime}-${formattedCloseTime}`;
        } else {
            return 'Closed';
        }
    });
    const fTiming = timeArr.join('_');
    return { fDays, fTiming };
};

/* convert  time */
export const convertTo24HourFormat = (timeStr) => {
  const [time, modifier] = timeStr.split(' '); 
  let [hours, minutes] = time.split(':');

  hours = String(hours); 

  if (modifier === 'PM' && hours !== '12') {
      hours = (parseInt(hours, 10) + 12).toString(); 
  }

  if (modifier === 'AM' && hours === '12') {
      hours = '00'; // Convert 12 AM to 00 hours
  }

  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`; 
};

/* Amount Number To Word Converter */
export function numberToWords(num) {
    const ones = [
        "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE",
        "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN",
        "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN",
        "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"
    ];
    const tens = [
        "ZERO", "TEN", "TWENTY", "THIRTY", "FORTY",
        "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"
    ];
    const hundreds = [
        "HUNDRED", "THOUSAND", "MILLION", "BILLION", "TRILLION", "QUARDRILLION"
    ];
    num = Number(num).toFixed(2);
    const numParts = num.split(".");
    const wholeNum = numParts[0];
    const decNum = numParts[1];

    const wholeArr = Array.from(wholeNum).reverse().join('').split(/(?=(?:\d{3})+$)/g).reverse();
    let resultText = "";

    for (let key = 0; key < wholeArr.length; key++) {
        let i = wholeArr[key].replace(/^0+/, '');

        if (i.length === 0) continue;

        if (i < 20) {
            resultText += ones[parseInt(i)];
        } else if (i < 100) {
            resultText += tens[Math.floor(i / 10)];
            if (i % 10 > 0) resultText += " " + ones[i % 10];
        } else {
            resultText += ones[Math.floor(i / 100)] + " " + hundreds[0];
            const remainder = i % 100;
            if (remainder > 0) {
                if (remainder < 20) {
                    resultText += " " + ones[remainder];
                } else {
                    resultText += " " + tens[Math.floor(remainder / 10)];
                    if (remainder % 10 > 0) resultText += " " + ones[remainder % 10];
                }
            }
        }
        if (key > 0) {
            resultText += " " + hundreds[key] + " ";
        }
    }
    if (decNum > 0) {
        resultText += " UAE Dirhams and ";
        if (decNum < 20) {
            resultText += ones[parseInt(decNum)];
        } else {
            resultText += tens[Math.floor(decNum / 10)];
            if (decNum % 10 > 0) resultText += " " + ones[decNum % 10];
        }
        resultText += " Fils Only";
    } else {
        resultText += " UAE Dirhams Only";
    }
    return resultText.replace("Uae", "UAE").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/* Format Number */
export function formatNumber(value) {
    return new Intl.NumberFormat('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
};

/* Create Notification */
export const createNotification = async (heading, desc, module_name, panel_to, panel_from, created_by, receive_id, href_url='') => {
    const result = await insertRecord('notifications', [
        'heading', 'description', 'module_name', 'panel_to', 'panel_from', 'created_by', 'receive_id', 'status', 'href_url'
    ],[
        heading, desc, module_name, panel_to, panel_from, created_by, receive_id, '0', href_url
    ]);

    return {
        affectedRows: result.affectedRows
    };
};

export const pushNotification = async ( deviceToken, title, body, fcmType, clickAction ) => {
    try {
        const accessToken      = await getAccessToken(fcmType);
        const clickActionParts = clickAction.split("/");
        
        const notification = {
          title: title,
          body: body,
        };
        const data = {
          title: title,
          body: body,
          click_action: clickActionParts[0],
          refrence_id: clickActionParts[1],
        };
        
        const message = {
          message: {
            token: deviceToken,
            notification: notification,
            data: data,
            apns: {
              payload: {
                aps: {
                  sound: "default",
                },
              },
            },
            android: {
              priority: "high",
              // notification: {
              //   click_action: clickActionParts[0],
              // },
            },
          },
        };        

        const projectId = (fcmType === 'RSAFCM') ? 'plusx-support' : 'plusx-electric-27f64';
        const url       = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        const response  = await axios.post(url, message, {
            headers : {
                'Authorization' : `Bearer ${accessToken}`,
                'Content-Type'  : 'application/json',
            },
        });
        // console.log('Notification sent successfully:', message);
    } catch (error) {
        console.error('Error sending notification:', error.response ? error.response.data : error.message);
    }
};

/* Fromat Date Time in Sql Query */
export const formatDateTimeInQuery = (columns) => {
    return columns.map(column => {
        if (column.includes('.')) {
            const alias = column.split('.').pop();
            return `DATE_FORMAT(CONVERT_TZ(${column}, 'UTC', 'Asia/Dubai'), '%Y-%m-%d %H:%i:%s') AS ${alias}`;
        } else {
            return `DATE_FORMAT(CONVERT_TZ(${column}, 'UTC', 'Asia/Dubai'), '%Y-%m-%d %H:%i:%s') AS ${column}`;
        }
    }).join(', ');
};

export const formatDateInQuery = (columns) => {
    return columns.map(column => {
        if (column.includes('.')) {
            const alias = column.split('.').pop();
            return `DATE_FORMAT(CONVERT_TZ(${column}, 'UTC', 'Asia/Dubai'), '%Y-%m-%d') AS ${alias}`;
        } else {
            return `DATE_FORMAT(CONVERT_TZ(${column}, 'UTC', 'Asia/Dubai'), '%Y-%m-%d') AS ${column}`;
        }
    }).join(', ');
};

/* Helper to delete a image from uploads/ */
export const deleteFile = (directory, filename) => {
    
    const oldImagePath = path.join(process.env.S3_FOLDER_NAME, directory, filename || '').replace(/\\/g, '/');
    deleteImageFromS3(oldImagePath);
};

export const asyncHandler = (fn) => {
    return function (req, res, next) {
        fn(req, res, next).catch(next);
    };
};

/* Generates a PDF from an EJS template. - M1 Not supported using puppeter */
export const generatePdf = async (templatePath, invoiceData, fileName, savePdfDir, req) => {
   
    return { success: true , pdfPath: ""} ;
};

// Get Route Map Single or Multiple
export const getSingleRoute = async (origin, destination) => {
    const apiKey = process.env.Google_map_key;
    const url    = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${apiKey}`;
    
    try {
        const response = await axios.get(url);
        const data     = response.data;

        if (data.status === 'OK') {
            const route = data.routes[0];
            const leg   = route.legs[0];

            // Optional: Return for frontend
            return {
                distance : leg.distance.text || "",
            };
        } else {
            console.error('Google API error:', data.status);
            return {err : data.status} ;
        }
    } catch (err) {
        console.error('Request failed:', err.message);
        return  { err : err.status} ;
    }
};

export const getMultipleRoute = async (origin, destinations) => {
    const apiKey  = process.env.Google_map_key;
    const destStr = destinations.map(d => `${d.latitude},${d.longitude}`).join('|');
    
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destStr}&mode=driving&key=${apiKey}`;
    const res = await axios.get(url);

    res.data.rows[0]?.elements.forEach((element, index) => {

        if (element.status === 'OK') {
            destinations[index].distance = parseFloat(element.distance.text);
            destinations[index].duration = element.duration.text;
        } else {
            destinations[index].distance = parseFloat(0);
            destinations[index].duration = "";
        }
    });
    return destinations;
}
