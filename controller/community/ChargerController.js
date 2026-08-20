import { mergeParam, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const assertCommunityAccess = (req, community_id, resp) => {
    if (req.manager && req.manager.community_id !== community_id) {
        resp.json({ status: 0, code: 403, message: 'Unauthorized access to this community.' });
        return false;
    }
    return true;
};

/**
 * Paginated charger list for the manager's community
 */
export const chargerList = asyncHandler(async (req, resp) => {
    try {
        const { community_id, page_no = 1, search_text = '' } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertCommunityAccess(req, community_id, resp)) return;

        const result = await getPaginatedData({
            tableName        : ' community_chargers as cc',
            columns          : `cc.charger_id, cc.kw, cl.community_name, cl.area_name,
                CASE WHEN cl.status = 1 THEN 'Active' ELSE 'Inactive' END AS status`,
            sortColumn       : 'cc.id',
            sortOrder        : 'DESC',
            page_no,
            liveSearchFields : ['cc.charger_id'],
            liveSearchTexts  : [search_text],
            limit            : 10,
            whereField       : ['cc.community_id'],
            whereValue       : [community_id],
            whereOperator    : ['='],
            joinTable        : ' community_list as cl ',
            joinCondition    : ' cl.community_id = cc.community_id ',
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ['Charger list fetched successfully!'],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.log('Error fetching community charger list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

/**
 * Charger details — only if the charger belongs to the manager's community
 */
export const chargerDetail = asyncHandler(async (req, resp) => {
    try {
        const { community_id, charger_id } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id : ['required'],
            charger_id   : ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertCommunityAccess(req, community_id, resp)) return;

        const charger = await queryDB(`
            SELECT
                cc.charger_id, cc.kw, cc.community_id,
                cl.community_name, cl.area_name,
                CASE WHEN cl.status = 1 THEN 'Active' ELSE 'Inactive' END AS status
            FROM community_chargers AS cc
            LEFT JOIN community_list AS cl ON cl.community_id = cc.community_id
            WHERE cc.charger_id = ? AND cc.community_id = ?
            LIMIT 1
        `, [charger_id, community_id]);

        if (!charger) {
            return resp.json({ status: 0, code: 404, message: 'Charger not found.' });
        }

        return resp.json({
            status  : 1,
            code    : 200,
            message : ['Charger details fetched successfully!'],
            data    : charger,
        });
    } catch (error) {
        console.log('Error fetching community charger details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
