SELECT wmenu_id, wmenu_id0, bar, RTRIM(bar) + '-' + wmenu_id AS text,
       xtype AS type, sysid, '' AS syscode, '' AS link,
       bar2, icon_url, icon_color, status, menu_id, xgroup, action
FROM dvcommand
