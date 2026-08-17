import { Router } from "express";
import { authenticateAdmin } from "../middleware/admin/authenticationMiddleware.js";
import { adminAuthorization } from "../middleware/admin/authorizeMiddleware.js";

import { login, logout, forgotPassword, updatePassword } from "../controller/admin/AuthController.js";

import { getDashboardData, riderList, riderDetails, deleteRider, notificationList, locationList, areaList, deletedRiderList, bookingAreaList, topRatedAreaList, riderBookingLists } from "../controller/admin/AdminController.js";

import { chargerBookingList, chargerBookingDetails, assignBooking, invoiceList, invoiceDetails, slotList, addSlot, editSlot, deleteSlot, slotDetails, adminCancelPCBooking, customerChargerBookingList, failedChargerBookingList, failedchargerBookingDetails
} from "../controller/admin/PortableChargerController.js";

import { handleFileUpload } from "../fileUpload.js";
import { 
    bookingDetails, bookingList, pdAddSlot, pdDeleteSlot, pdEditSlot, pdInvoiceDetails, pdInvoiceList, pdSlotList, PodAssignBooking as pdAssignBooking, pdSlotDetails, 
    adminCancelCSBooking, failedBookingList, failedbookingDetails  
} from "../controller/admin/PickAndDropController.js";

import { addPublicCharger, editPublicCharger, stationDetail, stationList, deletePublicCharger, deletePublicChargerGallery, stationData } from "../controller/admin/PublicChargerController.js";

import { chargerInstallationDetails, chargerInstallationList, eVChargerAdd, eVChargerList, chargerBrandList, chargerBrandCreate, chargerBrandUpdate, allChargerBrand, evChargerDetails, eVChargerEdit, AccessoriesAdd, AccessoriesList, AccessoriesDetails, AccessoriesEdit, deleteEVChargerGallery, PurchaseHistoryAdd, PurchaseHistoryList, PurchaseHistoryDetails, PurchaseHistoryEdit  } from "../controller/admin/ChargerInstallationController.js";

import { rsaList, rsaData, rsaAdd, rsaUpdate, rsaDelete, rsaStatusChange, driverBookingList, allRsaList, driverLocationList } from "../controller/admin/RsaController.js";

import {
    bookingData, bookingList as evRoadAssistanceBooking, invoiceList as evRoadAssistanceInvoice, invoiceData, evRoadAssistanceCancelBooking, rsaAssignBooking, failedRSABookingList, failedRSABookingDetails,
    rsaSlotList, rsaSlotDetails, rsaSlotAdd, rsaSlotEdit, rsaDeleteSlot, addOfflineRSABooking, editOfflineRSABooking, offlineRSABookingList, offlineRSABookingData, offlineRSAVehicleList
} from '../controller/admin/EvRoadAssistanceController.js'

import { couponDetail, couponList, couponAdd, couponEdit, couponDelete } from "../controller/admin/CouponController.js";
import { offerDetail, offerList, offerAdd, offerEdit, offerDelete, offerClickhistory } from "../controller/admin/OfferController.js";

import { evInsuranceList, evInsuranceDetail } from "../controller/admin/EvInsuranceController.js";
 
import { donwloadPodBookingList, donwloadUserList } from "../controller/ExportController.js";

import { podDeviceList, podDeviceDetails, addPodDevice, editPodDevice, deletePodDevice, AllpodDevice, addPodBrand, podBrandList, deviceBrandList, podAreaList, addPodArea, podAreaDetails, editPodArea, AllpodArea, assignPodDeviceArea, podAreaAssignList, podDeviceStatusChange, podAreaInputList, podAreaBookingList } from "../controller/admin/PodDeviceController.js";

import { chargeShareList, chargeShareDetail, outputAndConnector, editAcceptChargShare, rejectChargShare } from "../controller/admin/ChargeShareController.js";

import { communityList, communityDetail, addCommunity, editCommunity, allCommunityList, addResident, editResident, residentList, residentDetail, communityAreaList, residentSearch, getInvoiceData, createScanChargeInvoice, scanChargeInvoiceList, scanChargeInvoiceDetail, sessionList, sessionDetail } from "../controller/admin/CommunityController.js";
import { uploadFile, uploadFileMiddleware } from "../controller/admin/UploadController.js";

const router = Router();

const adminAuthRoutes = [
    { method: 'post', path: '/login', handler: login },
    { method: 'get',  path: '/pod-booking-list-download', handler: donwloadPodBookingList },
    { method: 'get',  path: '/user-signup-list-download', handler: donwloadUserList },
]
adminAuthRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, handler);
});

// Upload file to S3 and return URL (for manual insert into response_module via Postman)
// Auth: Authorization header only (API_AUTH_KEY) — no admin session required
router.post('/upload-file', adminAuthorization, uploadFileMiddleware, uploadFile);
const adminRoutes = [
    { method: 'post',  path: '/logout',             handler: logout },
    { method: 'post', path: '/forgot-password',     handler: forgotPassword },
    { method: 'put',  path: '/change-password',     handler: updatePassword },
    { method: 'post', path: '/dashboard',           handler: getDashboardData },
    { method: 'post', path: '/notification-list',   handler: notificationList },
    { method: 'post', path: '/rider-list',          handler: riderList },
    { method: 'post', path: '/rider-details',       handler: riderDetails },
    { method: 'post', path: '/delete-rider',        handler: deleteRider },
    { method: 'post', path: '/location-list',       handler: locationList },
    { method: 'post',  path: '/location-area-list', handler: areaList },
    { method: 'post', path: '/deleted-rider-list',  handler: deletedRiderList },
    { method: 'post',  path: '/all-area-list',      handler: bookingAreaList },

    /* Portable Charger */ 
    { method: 'post',   path: '/charger-booking-list',            handler: chargerBookingList },
    { method: 'post',   path: '/charger-booking-details',         handler: chargerBookingDetails },
    { method: 'post',   path: '/charger-booking-invoice-list',    handler: invoiceList },
    { method: 'post',   path: '/charger-booking-invoice-details', handler: invoiceDetails },
    { method: 'post',   path: '/charger-booking-assign',          handler: assignBooking },
    { method: 'post',   path: '/charger-slot-list',               handler: slotList },
    { method: 'post',   path: '/charger-slot-details',            handler: slotDetails },
    { method: 'post',   path: '/charger-add-time-slot',           handler: addSlot },
    { method: 'post',   path: '/charger-edit-time-slot',          handler: editSlot },
    { method: 'post',   path: '/charger-delete-time-slot',        handler: deleteSlot },
    { method: 'post',   path: '/customer-charger-booking-list',   handler: customerChargerBookingList },
    { method: 'post',   path: '/failed-charger-booking-list',     handler: failedChargerBookingList },
    { method: 'post',   path: '/failed-charger-booking-details',  handler: failedchargerBookingDetails },
    
    /* Pick & Drop */
    { method: 'post',   path: '/pick-and-drop-booking-list',     handler: bookingList },
    { method: 'post',   path: '/pick-and-drop-booking-details',  handler: bookingDetails },
    { method: 'post',   path: '/pick-and-drop-assign',           handler: pdAssignBooking },
    { method: 'post',   path: '/pick-and-drop-invoice-list',     handler: pdInvoiceList },
    { method: 'post',   path: '/pick-and-drop-invoice-details',  handler: pdInvoiceDetails },
    { method: 'post',   path: '/pick-and-drop-slot-list',        handler: pdSlotList },
    { method: 'post',   path: '/pick-and-drop-slot-details',     handler: pdSlotDetails },
    { method: 'post',   path: '/pick-and-drop-add-slot',         handler: pdAddSlot },
    { method: 'post',   path: '/pick-and-drop-edit-slot',        handler: pdEditSlot },
    { method: 'post',   path: '/pick-and-drop-delete-slot',            handler: pdDeleteSlot },
    { method: 'post',   path: '/failed-pick-and-drop-booking-list',    handler: failedBookingList },
    { method: 'post',   path: '/failed-pick-and-drop-booking-details', handler: failedbookingDetails },

    /* Public Charger */
    { method: 'post',   path: '/public-charger-station-list',    handler: stationList },
    { method: 'post',   path: '/public-charger-station-details', handler: stationDetail },
    { method: 'post',   path: '/public-charger-station-data',    handler: stationData },
    { method: 'post',   path: '/public-charger-add-station',     handler: addPublicCharger },
    { method: 'post',   path: '/public-charger-edit-station',    handler: editPublicCharger },
    { method: 'post',   path: '/public-chargers-delete',         handler: deletePublicCharger },
    { method: 'post',   path: '/chargers-gallery-del',           handler: deletePublicChargerGallery },

    /* Charger Installation */
    { method: 'post', path: '/charger-installation-list',    handler: chargerInstallationList },
    { method: 'post', path: '/charger-installation-details', handler: chargerInstallationDetails },
    
    /* RSA Routes */
    { method: 'post',  path: '/rsa-list',          handler: rsaList },
    { method: 'post',  path: '/rsa-data',          handler: rsaData },
    
    { method: 'post',  path: '/rsa-add',           handler: rsaAdd },
    { method: 'post',  path: '/rsa-update',        handler: rsaUpdate },
    { method: 'post',  path: '/rsa-delete',        handler: rsaDelete },
    { method: 'post',  path: '/rsa-status-change', handler: rsaStatusChange },
    { method: 'post',  path: '/rsa-booking-list',  handler: driverBookingList },
    { method: 'post',  path: '/all-rsa-list',      handler: allRsaList },
    { method: 'post',  path: '/rsa-location-list', handler: driverLocationList },

    /* EV Road Assistance */
    { method: 'post', path: '/ev-road-assistance-booking-list',    handler: evRoadAssistanceBooking },
    { method: 'post', path: '/ev-road-assistance-booking-details', handler: bookingData },
    { method: 'post', path: '/ev-road-assistance-add-offline-booking', handler: addOfflineRSABooking },
    { method: 'post', path: '/ev-road-assistance-edit-offline-booking', handler: editOfflineRSABooking },
    { method: 'post', path: '/ev-road-assistance-offline-booking-list', handler: offlineRSABookingList },
    { method: 'post', path: '/ev-road-assistance-offline-booking-details', handler: offlineRSABookingData },
    { method: 'post',  path: '/ev-road-assistance-offline-vehicle-list', handler: offlineRSAVehicleList },
    { method: 'post', path: '/ev-road-assistance-cancel-booking',  handler: evRoadAssistanceCancelBooking },
    { method: 'post', path: '/ev-road-assistance-invoice-list',    handler: evRoadAssistanceInvoice },
    { method: 'post', path: '/ev-road-assistance-invoice-data',    handler: invoiceData },
    { method: 'post', path: '/ev-road-assistance-assign',          handler: rsaAssignBooking },
    { method: 'post', path: '/failed-road-assistance-list',        handler: failedRSABookingList },
    { method: 'post', path: '/failed-road-assistance-details',     handler: failedRSABookingDetails },

    { method: 'post',   path: '/road-assistance-slot-list',        handler: rsaSlotList },
    { method: 'post',   path: '/road-assistance-slot-details',     handler: rsaSlotDetails },
    { method: 'post',   path: '/road-assistance-add-time-slot',    handler: rsaSlotAdd },
    { method: 'post',   path: '/road-assistance-edit-time-slot',   handler: rsaSlotEdit },
    { method: 'post',   path: '/road-assistance-delete-time-slot', handler: rsaDeleteSlot },

    /* Coupon */
    { method: 'post',   path: '/coupon-list',     handler: couponList },
    { method: 'post',   path: '/coupon-detail',   handler: couponDetail },
    { method: 'post',   path: '/coupon-data',     handler: couponDetail },
    { method: 'post',   path: '/add-coupan',      handler: couponAdd },
    { method: 'post',   path: '/edit-coupan',     handler: couponEdit },
    { method: 'post',   path: '/delete-coupan',   handler: couponDelete },

    /* Offer */
    { method: 'post',   path: '/offer-list',          handler: offerList },
    { method: 'post',   path: '/offer-detail',        handler: offerDetail },
    { method: 'post',   path: '/add-offer',           handler: offerAdd },
    { method: 'post',   path: '/edit-offer',          handler: offerEdit },
    { method: 'post',   path: '/delete-offer',        handler: offerDelete },
    { method: 'post',   path: '/offer-click-history', handler: offerClickhistory },

    /* EV Insurance */
    { method: 'post',  path: '/ev-insurance-list',    handler: evInsuranceList },
    { method: 'post',  path: '/ev-insurance-detail',  handler: evInsuranceDetail },

    /* Admin Booking Cancel */
    { method: 'post', path: '/portable-charger-cancel',  handler: adminCancelPCBooking },
    { method: 'post', path: '/charging-service-cancel',  handler: adminCancelCSBooking },
    
    /* POD Device Routes */ 
    { method: 'post',  path: '/pod-device-list',            handler: podDeviceList },
    { method: 'post',  path: '/pod-device-add',             handler: addPodDevice },
    { method: 'post',  path: '/pod-device-details',         handler: podDeviceDetails },
    { method: 'post',  path: '/pod-device-update',          handler: editPodDevice },
    { method: 'post',  path: '/pod-device-delete',          handler: deletePodDevice },
    { method: 'post',  path: '/pod-device-status-change',   handler: podDeviceStatusChange },

    /* POD Device Brand Routes */
    { method: 'post',  path: '/all-pod-device',             handler: AllpodDevice},
    { method: 'post',  path: '/pod-brand-list',             handler: podBrandList },
    { method: 'post',  path: '/add-pod-brand',              handler: addPodBrand },
    { method: 'post',  path: '/pod-brand-details',          handler: podDeviceDetails },
    { method: 'post',  path: '/edit-pod-brand',             handler: editPodDevice },
    { method: 'post',  path: '/pod-brand-delete',           handler: deletePodDevice },
    { method: 'post',  path: '/device-brand-list',          handler: deviceBrandList },

    /* POD Area Routes */
    { method: 'post',  path: '/pod-area-list',          handler: podAreaList },
    { method: 'post',  path: '/pod-area-add',           handler: addPodArea },
    { method: 'post',  path: '/pod-area-details',       handler: podAreaDetails },
    { method: 'post',  path: '/pod-area-update',        handler: editPodArea },
    { method: 'post',  path: '/all-pod-area',           handler: AllpodArea},
    { method: 'post',  path: '/pod-assign-area',        handler: assignPodDeviceArea},
    { method: 'post',  path: '/pod-assign-area-list',   handler: podAreaAssignList},
    { method: 'post',  path: '/pod-output-history',     handler: podAreaInputList},
    { method: 'post',  path: '/pod-booking-history',    handler: podAreaBookingList},

    // EV Charger / Accessories  
    { method: 'post', path: '/charger-brand-list',     handler: chargerBrandList },
    { method: 'post', path: '/charger-brand-create',   handler: chargerBrandCreate },
    { method: 'post', path: '/charger-brand-update',   handler: chargerBrandUpdate },

    { method: 'post', path: '/ev-charger-add',         handler: eVChargerAdd },
    { method: 'post', path: '/ev-charger-list',        handler: eVChargerList },
    { method: 'post', path: '/ev-all-charger-list',    handler: allChargerBrand },
    { method: 'post', path: '/ev-charger-details',     handler: evChargerDetails },
    { method: 'post', path: '/ev-charger-edit',         handler: eVChargerEdit },

    { method: 'post', path: '/ev-accessories-add',       handler: AccessoriesAdd },
    { method: 'post', path: '/ev-accessories-list',      handler: AccessoriesList },    
    { method: 'post', path: '/ev-accessories-details',   handler: AccessoriesDetails },
    { method: 'post', path: '/ev-accessories-edit',      handler: AccessoriesEdit },
    { method: 'post', path: '/ev-charger-gallery-del',   handler: deleteEVChargerGallery }, 

    // Purchase History Routes
    { method: 'post', path: '/add-purchase-history',     handler: PurchaseHistoryAdd },
    { method: 'post', path: '/purchase-history-list',    handler: PurchaseHistoryList },
    { method: 'post', path: '/purchase-history-details', handler: PurchaseHistoryDetails },
    { method: 'post', path: '/purchase-history-edit',    handler: PurchaseHistoryEdit }, 
    
    // Charge Share Routes
    { method: 'post', path: '/charge-share-list',    handler : chargeShareList },
    { method: 'post', path: '/charge-share-details', handler : chargeShareDetail },
    { method: 'post', path: '/charge-share-master',  handler : outputAndConnector },
    { method: 'post', path: '/charge-share-accept',  handler : editAcceptChargShare },
    { method: 'post', path: '/charge-share-reject',  handler : rejectChargShare },

    { method: 'post',  path: '/top-rated-area-list', handler: topRatedAreaList },
    { method: 'post',  path: '/rider-booking-list', handler: riderBookingLists },

    // Community Routes
    { method: 'post',  path: '/community-add',       handler: addCommunity },
    { method: 'post',  path: '/community-edit',      handler: editCommunity },
    { method: 'post',  path: '/community-list',      handler: communityList },
    { method: 'post',  path: '/community-details',   handler: communityDetail },
    { method: 'post',  path: '/all-community-list',  handler: allCommunityList },
    { method: 'post',  path: '/community-area-list', handler: communityAreaList },

    // Resident Routes
    { method: 'post',  path: '/resident-add',     handler: addResident },
    { method: 'post',  path: '/resident-edit',    handler: editResident },
    { method: 'post',  path: '/resident-list',    handler: residentList },
    { method: 'post',  path: '/resident-details', handler: residentDetail },

    
    { method: 'post',  path: '/resident-search',            handler : residentSearch }, 
    { method: 'post',  path: '/get-invoice-data',           handler : getInvoiceData }, 
    { method: 'post',  path: '/create-scan-charge-invoice', handler : createScanChargeInvoice },
    { method: 'post',  path: '/scan-charge-invoice-list',   handler : scanChargeInvoiceList },
    { method: 'post',  path: '/scan-charge-invoice-detail', handler : scanChargeInvoiceDetail },

    { method: 'post',  path: '/session-list',    handler : sessionList },
    { method: 'post',  path: '/session-detail',  handler : sessionDetail },
]; 
// Define your upload rules in a config map
const uploadRules = {
     
    '/rsa-add'    : { folder: 'rsa_images', fields: ['profile_image'], maxCount: 1 },
    '/rsa-update' : { folder: 'rsa_images', fields: ['profile_image'], maxCount: 1 },
     
    '/public-charger-add-station'  : { folder: 'charging-station-images', fields: ['cover_image', 'shop_gallery'], maxCount: 5 },
    '/public-charger-edit-station' : { folder: 'charging-station-images', fields: ['cover_image', 'shop_gallery'], maxCount: 5 },

    '/add-offer'          : { folder: 'offer',              fields: ['offer_image'],   maxCount: 1 },
    '/edit-offer'         : { folder: 'offer',              fields: ['offer_image'],   maxCount: 1 },
     
    '/add-pod-brand'      : { folder: 'pod-brand-images', fields: ['brand_image'],   maxCount: 1 },
    '/edit-pod-brand'     : { folder: 'pod-brand-images', fields: ['brand_image'],   maxCount: 1 },

    '/ev-charger-add' : { folder: 'charger-installation', fields: ['charger_image', 'specification_pdf', 'charger_gallery'], maxCount: 2},
    '/ev-charger-edit': { folder: 'charger-installation', fields: ['charger_image', 'specification_pdf', 'charger_gallery'], maxCount: 2},

    '/ev-accessories-add' : { folder: 'charger-installation', fields: ['charger_image', 'specification_pdf', 'charger_gallery'], maxCount: 2},
    '/ev-accessories-edit': { folder: 'charger-installation', fields: ['charger_image', 'specification_pdf', 'charger_gallery'], maxCount: 2},

    '/ev-road-assistance-add-offline-booking'  : { folder: 'rsa-offline-proof', fields: ['proof_of_transaction'], maxCount: 1 },
    '/ev-road-assistance-edit-offline-booking' : { folder: 'rsa-offline-proof', fields: ['proof_of_transaction'], maxCount: 1 },

    '/add-purchase-history' : { folder: 'charger-installation', fields: ['purchase_invoice_pdf', 'installation_invoice_pdf', 'completion_certificate_pdf'], maxCount: 3},
    '/purchase-history-edit' : { folder: 'charger-installation', fields: ['purchase_invoice_pdf', 'installation_invoice_pdf', 'completion_certificate_pdf'], maxCount: 3},
    '/charge-share-accept'  : { folder: 'charge-share-images', fields: ['charger_image'], maxCount: 1 },
};

adminRoutes.forEach(({ method, path, handler }) => {
    const middlewares = [adminAuthorization];

    // Apply middleware based on current path
    const rule = uploadRules[path];
    if (rule) {
        middlewares.push(handleFileUpload(rule.folder, rule.fields, rule.maxCount));
    }
    middlewares.push(authenticateAdmin);
    router[method](path, ...middlewares, handler);
});

export default router;