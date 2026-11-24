/**
 * Rednote 批量取关助手 - Chrome/Edge Extension Content Script
 * 运行于网页主上下文 (world: MAIN)，直接复用原生网络客户端与会话签名
 */
(function() {
    'use strict';

    console.log('[Rednote助手 v1.0.0] 脚本已加载');

    // 1. 动态自适应探测小红书内部 HTTP 客户端
    async function getNativeHttp(maxRetries = 20) {
        if (window.__xhs_http__) return window.__xhs_http__;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (window.webpackChunkxhs_pc_web) {
                let foundHttp = null;
                try {
                    window.webpackChunkxhs_pc_web.push([[Symbol()], {}, (__webpack_require__) => {
                        if (!__webpack_require__) return;

                        const cache = __webpack_require__.c || {};
                        for (const id in cache) {
                            const exp = cache[id]?.exports;
                            if (!exp) continue;
                            if (typeof exp.get === 'function' && typeof exp.post === 'function' && (typeof exp.makeUri === 'function' || typeof exp.buildURL === 'function')) {
                                foundHttp = exp;
                                return;
                            }
                            if (exp.default && typeof exp.default.get === 'function' && typeof exp.default.post === 'function' && (typeof exp.default.makeUri === 'function' || typeof exp.default.buildURL === 'function')) {
                                foundHttp = exp.default;
                                return;
                            }
                            if (exp.dJ && typeof exp.dJ.get === 'function' && typeof exp.dJ.post === 'function') {
                                foundHttp = exp.dJ;
                                return;
                            }
                        }

                        const modules = __webpack_require__.m || {};
                        for (const id in modules) {
                            const fn = modules[id];
                            if (typeof fn !== 'function') continue;
                            const fnStr = fn.toString();
                            if (fnStr.includes('makeUri') && (fnStr.includes('buildURL') || fnStr.includes('interceptors'))) {
                                try {
                                    const mod = __webpack_require__(id);
                                    if (mod && typeof mod.get === 'function' && typeof mod.post === 'function') {
                                        foundHttp = mod;
                                        return;
                                    }
                                } catch(e) {}
                            }
                        }
                    }]);
                } catch(err) {}

                if (foundHttp) {
                    try {
                        if (foundHttp.defaults) foundHttp.defaults.timeout = 60000;
                    } catch(e) {}
                    window.__xhs_http__ = foundHttp;
                    console.log('[Rednote助手] 成功探测并挂载小红书原生 HTTP 客户端 (尝试轮次: ' + attempt + ')');
                    return foundHttp;
                }
            }
            await new Promise(r => setTimeout(r, 300));
        }
        console.error('[Rednote助手] 未能探测到小红书原生 HTTP 客户端，请确认当前处于登录状态的小红书网页端');
        return null;
    }

    // 2. 注入全局样式
    const style = document.createElement('style');
    style.innerHTML = `
        #rn-fab {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 9999999;
            background: linear-gradient(135deg, #ff2442 0%, #ff526b 100%);
            color: #ffffff;
            padding: 12px 22px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 6px 20px rgba(255, 36, 66, 0.45);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        }
        #rn-fab:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 26px rgba(255, 36, 66, 0.6);
        }
        #rn-modal-overlay {
            position: fixed;
            inset: 0;
            z-index: 10000000;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(4px);
            display: none;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        #rn-modal-overlay.active { display: flex; }
        .rn-container {
            background: #ffffff;
            border-radius: 20px;
            width: 100%;
            max-width: 960px;
            height: 88vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
        }
        .rn-top {
            padding: 14px 24px;
            border-bottom: 1px solid #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #ffffff;
        }
        .rn-tools {
            padding: 10px 24px;
            background: #f8fafc;
            border-bottom: 1px solid #f1f5f9;
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .rn-list {
            padding: 16px 24px;
            overflow-y: auto;
            flex: 1;
            background: #fdfdfd;
        }
        .rn-item {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 12px 16px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all 0.15s;
            background: #ffffff;
            cursor: pointer;
        }
        .rn-item:hover { border-color: #cbd5e1; background: #f8fafc; }
        .rn-item.selected { border-color: #ff2442; background: #fff5f5; }
        .rn-item.mutual { border-left: 4px solid #10b981; }
        .rn-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            object-fit: cover;
            border: 1px solid #e2e8f0;
            background: #f1f5f9;
            flex-shrink: 0;
        }
        .rn-user-name {
            font-weight: 700;
            font-size: 14px;
            color: #0f172a;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .rn-user-name:hover { color: #ff2442; text-decoration: underline; }
        .rn-btn {
            background: #ffffff;
            color: #334155;
            border: 1px solid #cbd5e1;
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.15s;
            user-select: none;
        }
        .rn-btn:hover { background: #f1f5f9; border-color: #94a3b8; }
        .rn-btn-primary {
            background: #ff2442;
            color: #ffffff;
            border-color: #ff2442;
        }
        .rn-btn-primary:hover { background: #e01b38; }
        .rn-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .rn-btn-success {
            background: #059669;
            color: #ffffff;
            border-color: #059669;
        }
        .rn-btn-success:hover { background: #047857; }
        .badge-mutual {
            background: #ecfdf5;
            color: #047857;
            border: 1px solid #a7f3d0;
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 2px;
        }
        .badge-single {
            background: #f1f5f9;
            color: #64748b;
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
        }
    `;
    document.head.appendChild(style);

    // 3. 创建悬浮球
    const fab = document.createElement('div');
    fab.id = 'rn-fab';
    fab.innerHTML = '<span>⚡</span> <span>批量取关助手</span>';
    document.body.appendChild(fab);

    // 4. 创建弹窗界面
    const overlay = document.createElement('div');
    overlay.id = 'rn-modal-overlay';
    overlay.innerHTML = `
        <div class="rn-container">
            <div class="rn-top">
                <div style="font-size:16px; font-weight:700; display:flex; align-items:center; gap:8px;">
                    <span style="color:#ff2442;">🔴</span> Rednote 批量取关助手 (互关置顶 / 单向倒序)
                </div>
                <button id="rn-close" style="border:none;background:none;font-size:24px;cursor:pointer;color:#94a3b8;line-height:1;">&times;</button>
            </div>

            <!-- 工具栏第一行：UID 与自动全量拉取 -->
            <div class="rn-tools" style="background:#f1f5f9; padding-bottom:8px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:12px; font-weight:600; color:#334155;">目标 UID:</span>
                    <input id="rn-uid-input" type="text" placeholder="输入 UID..." style="padding:5px 8px; border-radius:6px; border:1px solid #cbd5e1; font-size:12px; width:210px; font-family:monospace;" />
                    <button id="rn-btn-fetch-page" class="rn-btn" title="只拉取一页 (20人)">拉取单页</button>
                    <button id="rn-btn-fetch-all" class="rn-btn rn-btn-success" title="自动循环分页，拉完所有关注列表">⚡ 一键拉取全部</button>
                    <button id="rn-btn-stop-fetch" class="rn-btn" style="display:none; color:#ef4444; border-color:#fca5a5;">⏹ 停止拉取</button>
                </div>
                <div style="flex:1;"></div>
                <div id="rn-stats-badge" style="font-size:12px; color:#475569; font-weight:600;">
                    总数: 0 · 互关: 0 · 单向: 0
                </div>
            </div>

            <!-- 工具栏第二行：过滤筛选与批量选择 -->
            <div class="rn-tools">
                <input id="rn-search-input" type="text" placeholder="搜索博主昵称 / UID..." style="padding:6px 10px; border-radius:8px; border:1px solid #cbd5e1; font-size:12px; width:160px;" />
                
                <div style="display:flex; gap:4px;">
                    <button id="rn-filter-all" class="rn-btn" style="background:#0f172a; color:#fff;">全部</button>
                    <button id="rn-filter-mutual" class="rn-btn">仅互关</button>
                    <button id="rn-filter-single" class="rn-btn">仅单向</button>
                </div>

                <div style="height:18px; width:1px; background:#cbd5e1; margin:0 4px;"></div>

                <button id="rn-btn-select-all" class="rn-btn">全选</button>
                <button id="rn-btn-invert" class="rn-btn">反选</button>
                <button id="rn-btn-clear" class="rn-btn" style="color:#ef4444;" title="取消所有已选勾选">清空勾选</button>
                <button id="rn-btn-select-single-only" class="rn-btn" style="background:#fee2e2; color:#b91c1c; border-color:#fca5a5;" title="一键只勾选所有单向关注的人（不取关互关好友）">
                  🎯 仅勾选所有单向关注
                </button>

                <div style="flex:1;"></div>
                <span id="rn-selected-stat" style="font-size:13px; font-weight:700; color:#ff2442;">已选 0 人</span>
                <button id="rn-btn-batch-unfollow" class="rn-btn rn-btn-primary" disabled>批量取关所选</button>
            </div>

            <!-- 用户卡片列表容器 -->
            <div id="rn-user-list-view" class="rn-list">
                <div style="text-align:center; padding:60px 20px; color:#94a3b8; font-size:13px;">
                    点击上方【⚡ 一键拉取全部】或【拉取单页】开始加载关注列表
                </div>
            </div>

            <!-- 底部状态条 -->
            <div style="padding:10px 24px; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#64748b; background:#fff; flex-wrap:wrap; gap:8px;">
                <span id="rn-footer-status">就绪</span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button id="rn-btn-export-backup" class="rn-btn" title="导出当前所有抓取的关注列表为 CSV 备份文件">💾 备份关注列表 (CSV)</button>
                    <button id="rn-btn-export-records" class="rn-btn" title="导出本次取关的操作记录明细">📥 导出取关记录 (CSV)</button>
                    <button id="rn-btn-load-more" class="rn-btn" style="display:none;">加载下一页 (20人)</button>
                    <button id="rn-btn-reset" class="rn-btn">重置清空</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // 全局数据状态
    let followingUsers = [];       // 全部用户数组 (存储带 _index 的原始项)
    let selectedUids = new Set();  // 已选中的 UID
    let unfollowRecords = [];      // 取关操作记录日志
    let currentCursor = '';        // 分页游标
    let hasMoreData = false;       // 是否有下一页
    let isFetchingAll = false;     // 是否正在全量拉取中
    let isExecutingUnfollow = false;// 是否正在执行取关
    let currentFilterMode = 'all'; // all | mutual | single

    // 动态智能检测当前用户 UID (零硬编码)
    function detectDefaultUid() {
        const urlMatch = location.pathname.match(/\/user\/profile\/([a-zA-Z0-9]{24})/);
        if (urlMatch) return urlMatch[1];
        
        try {
            const stateUid = window.__INITIAL_STATE__?.user?.userInfo?.userId;
            if (stateUid) return String(stateUid);
        } catch(e) {}

        const profileLinks = Array.from(document.querySelectorAll('a[href*="/user/profile/"]'));
        for (const a of profileLinks) {
            if (a.closest('#rn-modal-overlay')) continue;
            const m = a.href.match(/\/user\/profile\/([a-zA-Z0-9]{24})/);
            if (m) return m[1];
        }
        return '';
    }

    fab.onclick = () => {
        overlay.classList.add('active');
        const uidInput = document.getElementById('rn-uid-input');
        if (!uidInput.value) {
            const autoUid = detectDefaultUid();
            if (autoUid) {
                uidInput.value = autoUid;
                console.log('[Rednote助手] 自动识别到当前用户 UID:', autoUid);
            } else {
                console.warn('[Rednote助手] 未能在当前页面自动识别到 UID，请手动输入 24 位用户 ID');
            }
        }
    };

    overlay.querySelector('#rn-close').onclick = () => overlay.classList.remove('active');
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('active'); };

    function getCleanUid() {
        let val = document.getElementById('rn-uid-input').value.trim();
        const match = val.match(/\/user\/profile\/([a-zA-Z0-9]{24})/);
        if (match) {
            val = match[1];
            document.getElementById('rn-uid-input').value = val;
        }
        const finalUid = val || detectDefaultUid();
        if (!finalUid) {
            throw new Error('未检测到用户 UID！请在上方输入框填入您的 24 位用户 ID，或先打开您的小红书个人主页');
        }
        return finalUid;
    }

    // 核心拉取单页数据 (返回 { newUsers, nextCursor, hasMore })
    async function fetchSinglePage(targetUid, cursor) {
        const http = await getNativeHttp();
        if (!http) throw new Error('未能获取小红书原生 HTTP 客户端');

        console.log('[Rednote助手] 正在拉取关注列表 -> UID:', targetUid, '游标(cursor):', cursor || '(首页)');
        const res = await http.get('/api/sns/web/v1/user/followings', {
            params: {
                user_id: targetUid,
                cursor: cursor || '',
                order: 0, // 0 = TimeDesc (关注时间倒序，最新关注在最前)
                source: 'user_profile'
            },
            timeout: 60000
        });

        const rawData = res.data || res;
        const rawList = rawData.users || rawData.userList || [];
        const nextCursor = rawData.cursor || '';
        const hasMore = !!rawData.hasMore;
        console.log('[Rednote助手] 关注列表拉取成功 -> 本页人数:', rawList.length, '是否有下一页(hasMore):', hasMore, '新游标:', nextCursor);

        // 调试打印：输出前 2 位用户的真实关系字段，方便排查确认
        if (!cursor && rawList.length > 0) {
            console.log('[Rednote助手 状态分析] 前2位博主返回结构:', rawList.slice(0, 2).map(x => ({
                nickname: x.nickname,
                userId: x.userId,
                fstatus: x.fstatus,
                followStatus: x.followStatus
            })));
        }

        const newUsers = rawList.map(u => {
            let avatarUrl = 'https://fe-platform.xhscdn.com/platform/104101l0322r3hn9jna06is1lkgjp20000000007p5j89k.png';
            if (typeof u.images === 'string' && u.images) avatarUrl = u.images;
            else if (typeof u.image === 'string' && u.image) avatarUrl = u.image;
            else if (typeof u.avatar === 'string' && u.avatar) avatarUrl = u.avatar;

            // 保留原始 fstatus，Rednote 官方格式为 "both" / "follows" / "fans" 或数值 1
            const rawFstatus = u.fstatus !== undefined ? u.fstatus : (u.followStatus !== undefined ? u.followStatus : 'follows');

            return {
                userId: String(u.userId || u.id || ''),
                nickname: u.nickname || u.name || '红薯博主',
                avatar: avatarUrl,
                desc: u.desc || u.remark || '',
                xsecToken: u.xsecToken || u.xsec_token || '',
                fstatus: rawFstatus,
                fansCount: u.fans || u.fanCount || 0,
                noteCount: u.ndiscovery || u.noteCount || 0
            };
        });

        return { newUsers, nextCursor, hasMore };
    }

    // 诉求 1：自动全量拉取所有列表（带 500ms 安全间隔与实时更新）
    async function startFetchAll() {
        if (isFetchingAll) return;

        // 如果已经到底且已有数据，询问是否重新从头拉取
        if (!hasMoreData && followingUsers.length > 0) {
            if (confirm(`当前已加载了全部 ${followingUsers.length} 位博主。是否清空并从头重新拉取？`)) {
                followingUsers = [];
                selectedUids.clear();
                currentCursor = '';
                hasMoreData = false;
            } else {
                return;
            }
        }

        isFetchingAll = true;
        document.getElementById('rn-btn-fetch-all').style.display = 'none';
        document.getElementById('rn-btn-stop-fetch').style.display = 'inline-block';
        document.getElementById('rn-btn-fetch-page').disabled = true;

        const targetUid = getCleanUid();
        const footerStatus = document.getElementById('rn-footer-status');

        let pageCount = 1;
        footerStatus.innerText = `[全量拉取中] 正在拉取第 1 页...`;

        try {
            while (isFetchingAll) {
                const { newUsers, nextCursor, hasMore } = await fetchSinglePage(targetUid, currentCursor);
                
                // 去重并按原有顺序记录序号
                newUsers.forEach(u => {
                    if (!followingUsers.some(ex => ex.userId === u.userId)) {
                        u._index = followingUsers.length; // 记录时间倒序原始索引
                        followingUsers.push(u);
                    }
                });

                currentCursor = nextCursor;
                hasMoreData = hasMore;

                // 适当节流渲染，避免高频全量 DOM 销毁重建
                if (followingUsers.length <= 80 || pageCount % 2 === 0 || !hasMore) {
                    renderListView();
                }
                updateStatsUI();

                footerStatus.innerText = `[全量拉取中] 已拉取第 ${pageCount} 页 (已获取 ${followingUsers.length} 人)...`;

                if (!hasMore || !currentCursor) {
                    renderListView();
                    footerStatus.innerText = `🎉 全量拉取完成！共抓取 ${followingUsers.length} 位关注博主`;
                    break;
                }

                pageCount++;
                // 每次翻页安全间隔 500ms
                await new Promise(r => setTimeout(r, 500));
            }
        } catch(err) {
            console.error('[Rednote助手] 全量拉取中断:', err);
            renderListView();
            footerStatus.innerText = `拉取中断: ${err.message} (已保留前 ${followingUsers.length} 人，可再次点击继续)`;
        } finally {
            isFetchingAll = false;
            document.getElementById('rn-btn-fetch-all').style.display = 'inline-block';
            document.getElementById('rn-btn-stop-fetch').style.display = 'none';
            document.getElementById('rn-btn-fetch-page').disabled = false;
            document.getElementById('rn-btn-load-more').style.display = hasMoreData ? 'inline-block' : 'none';
        }
    }

    // 单页拉取
    async function fetchOnePage(reset = false) {
        const targetUid = getCleanUid();
        const footerStatus = document.getElementById('rn-footer-status');
        const listView = document.getElementById('rn-user-list-view');

        if (reset) {
            followingUsers = [];
            selectedUids.clear();
            currentCursor = '';
            hasMoreData = false;
            listView.innerHTML = '<div style="text-align:center; padding:60px 20px; color:#64748b;">正在拉取数据...</div>';
        }

        footerStatus.innerText = `正在拉取 (UID: ${targetUid})...`;
        try {
            const { newUsers, nextCursor, hasMore } = await fetchSinglePage(targetUid, currentCursor);
            newUsers.forEach(u => {
                if (!followingUsers.some(ex => ex.userId === u.userId)) {
                    u._index = followingUsers.length;
                    followingUsers.push(u);
                }
            });

            currentCursor = nextCursor;
            hasMoreData = hasMore;

            renderListView();
            updateStatsUI();
            footerStatus.innerText = `已加载 ${followingUsers.length} 人${hasMoreData ? ' (可继续拉取)' : ' (已到底)'}`;
            document.getElementById('rn-btn-load-more').style.display = hasMoreData ? 'inline-block' : 'none';
        } catch(err) {
            console.error('[Rednote助手] 拉取单页失败:', err);
            footerStatus.innerText = `拉取失败: ${err.message}`;
        }
    }

    // 核心关系判断：兼容 Rednote 官方字符串 'both' 与数字 1
    function isMutualFollow(u) {
        if (!u) return false;
        const fs = u.fstatus !== undefined ? u.fstatus : u.followStatus;
        if (typeof fs === 'string') {
            const lower = fs.toLowerCase().trim();
            return lower === 'both' || lower === '1';
        }
        if (typeof fs === 'number') {
            return fs === 1;
        }
        return Boolean(u.mutual || u.isMutual || u.isBoth);
    }

    // 权威通用判断小红书取关响应是否成功
    function checkUnfollowSuccess(res) {
        if (!res) return false;
        const resData = (res && typeof res.data !== 'undefined') ? res.data : res;

        // 1. 小红书官方取关成功的核心标志：fstatus 变为 'none' (已解包拦截器直接返回 { fstatus: 'none' })
        if (res?.fstatus === 'none' || resData?.fstatus === 'none' || resData?.data?.fstatus === 'none') {
            return true;
        }
        // 2. 标准成功状态码
        if (res?.code === 0 || resData?.code === 0 || resData?.data?.code === 0 || res?.success === true || resData?.success === true) {
            return true;
        }
        // 3. 包含明确的错误码判定为失败
        if (typeof resData?.code === 'number' && resData.code !== 0) {
            return false;
        }
        // 4. 小红书内部拦截器正常 resolve 且无错误字段判定为成功
        if (typeof resData === 'object' && !resData?.error && !resData?.err_code) {
            return true;
        }
        return false;
    }


    // 诉求 2：互关置顶 + 其余按关注时间倒序（最近关注最前）
    function getSortedList() {
        const list = [...followingUsers];
        list.sort((a, b) => {
            const aIsMutual = isMutualFollow(a) ? 1 : 0;
            const bIsMutual = isMutualFollow(b) ? 1 : 0;
            
            // 互关排在最前面 (1 > 0)
            if (aIsMutual !== bIsMutual) {
                return bIsMutual - aIsMutual;
            }
            // 同为互关或同为单向：按原本抓取顺序（关注时间倒序，_index 越小越新）
            return (a._index ?? 0) - (b._index ?? 0);
        });
        return list;
    }

    // 渲染列表
    function renderListView() {
        const listView = document.getElementById('rn-user-list-view');
        const kw = document.getElementById('rn-search-input').value.trim().toLowerCase();
        
        let sorted = getSortedList();

        // 筛选标签
        if (currentFilterMode === 'mutual') {
            sorted = sorted.filter(u => isMutualFollow(u));
        } else if (currentFilterMode === 'single') {
            sorted = sorted.filter(u => !isMutualFollow(u));
        }

        // 搜索关键词过滤
        if (kw) {
            sorted = sorted.filter(u => u.nickname.toLowerCase().includes(kw) || String(u.userId).includes(kw));
        }

        if (sorted.length === 0) {
            listView.innerHTML = '<div style="text-align:center; padding:60px 20px; color:#94a3b8;">未找到匹配博主</div>';
            return;
        }

        listView.innerHTML = '';
        sorted.forEach(u => {
            const uidStr = String(u.userId);
            const isChecked = selectedUids.has(uidStr);
            const isMutual = isMutualFollow(u);
            const item = document.createElement('div');
            item.className = `rn-item ${isChecked ? 'selected' : ''} ${isMutual ? 'mutual' : ''}`;

            let profileUrl = `${location.origin}/user/profile/${u.userId}`;
            if (u.xsecToken) {
                profileUrl += `?xsec_token=${encodeURIComponent(u.xsecToken)}&xsec_source=pc_followed`;
            }

            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                    <input type="checkbox" class="rn-checkbox" ${isChecked ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
                    <img class="rn-avatar" src="${u.avatar}" />
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <a href="${profileUrl}" target="_blank" class="rn-user-name" title="点击打开真实个人主页">
                                ${escapeHtml(u.nickname)}
                                <span style="font-size:11px; color:#94a3b8; font-weight:normal;">↗</span>
                            </a>
                            ${isMutual ? '<span class="badge-mutual">👑 互相关注</span>' : '<span class="badge-single">单向关注</span>'}
                        </div>
                        <div style="font-size:11px; color:#94a3b8; margin-top:1px;">UID: ${u.userId}</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${escapeHtml(u.desc || '暂无个人简介')}
                        </div>
                    </div>
                </div>
                <div style="margin-left:16px;">
                    <button class="rn-btn rn-btn-single-unfollow" style="color:#ef4444;">取关</button>
                </div>
            `;

            // 点击卡片任意区域切换勾选/取消勾选
            item.onclick = (e) => {
                if (e.target.closest('a') || e.target.closest('button')) return;
                const cb = item.querySelector('.rn-checkbox');
                if (selectedUids.has(uidStr)) {
                    selectedUids.delete(uidStr);
                    if (cb) cb.checked = false;
                    item.classList.remove('selected');
                } else {
                    selectedUids.add(uidStr);
                    if (cb) cb.checked = true;
                    item.classList.add('selected');
                }
                updateSelectedCountUI();
            };

            // 复选框点击阻止事件冒泡
            const cb = item.querySelector('.rn-checkbox');
            cb.onclick = (e) => {
                e.stopPropagation();
            };
            cb.onchange = (e) => {
                if (e.target.checked) {
                    selectedUids.add(uidStr);
                    item.classList.add('selected');
                } else {
                    selectedUids.delete(uidStr);
                    item.classList.remove('selected');
                }
                updateSelectedCountUI();
            };

            // 单个取关
            item.querySelector('.rn-btn-single-unfollow').onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`确认取消关注 "${u.nickname}" 吗？`)) return;
                const http = await getNativeHttp();
                try {
                    console.log('[Rednote助手] 发起单个取关请求 -> 博主:', u.nickname, 'UID:', u.userId);
                    const res = await http.post('/api/sns/web/v1/user/unfollow', { target_user_id: u.userId }, { timeout: 30000 });
                    const resData = (res && typeof res.data !== 'undefined') ? res.data : res;
                    const isSuccess = checkUnfollowSuccess(res);
                    if (!isSuccess) {
                        throw new Error(resData?.msg || resData?.message || resData?.error || JSON.stringify(res) || '接口响应失败');
                    }
                    console.log('[Rednote助手] 单个取关成功 -> 博主:', u.nickname, '响应体:', resData);
                    followingUsers = followingUsers.filter(x => String(x.userId) !== uidStr);
                    selectedUids.delete(uidStr);
                    
                    unfollowRecords.push({
                        time: new Date().toLocaleString(),
                        userId: uidStr,
                        nickname: u.nickname,
                        relation: isMutualFollow(u) ? '互相关注' : '单向关注',
                        fansCount: u.fansCount || 0,
                        status: '成功',
                        errorReason: '',
                        profileUrl: `${location.origin}/user/profile/${u.userId}`
                    });

                    renderListView();
                    updateStatsUI();
                    updateSelectedCountUI();
                } catch(err) {
                    unfollowRecords.push({
                        time: new Date().toLocaleString(),
                        userId: uidStr,
                        nickname: u.nickname,
                        relation: isMutualFollow(u) ? '互相关注' : '单向关注',
                        fansCount: u.fansCount || 0,
                        status: '失败',
                        errorReason: err.message,
                        profileUrl: `${location.origin}/user/profile/${u.userId}`
                    });
                    alert('取关失败: ' + err.message);
                }
            };

            listView.appendChild(item);
        });

        updateSelectedCountUI();
    }

    function updateStatsUI() {
        const total = followingUsers.length;
        const mutual = followingUsers.filter(u => isMutualFollow(u)).length;
        const single = total - mutual;
        document.getElementById('rn-stats-badge').innerText = `已拉取: ${total} · 👑 互关: ${mutual} · 单向: ${single}`;
    }

    function updateSelectedCountUI() {
        const count = selectedUids.size;
        document.getElementById('rn-selected-stat').innerText = `已选 ${count} 人`;
        document.getElementById('rn-btn-batch-unfollow').disabled = count === 0 || isExecutingUnfollow;

        // 全选按钮智能文案：若当前列表已全部勾选，则显示“取消全选”
        const selectAllBtn = document.getElementById('rn-btn-select-all');
        if (selectAllBtn) {
            const currentSorted = getSortedList();
            const allSelected = currentSorted.length > 0 && currentSorted.every(u => selectedUids.has(String(u.userId)));
            selectAllBtn.innerText = allSelected ? '取消全选' : '全选';
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }

    // 按钮事件绑定
    document.getElementById('rn-btn-fetch-all').onclick = () => startFetchAll();
    document.getElementById('rn-btn-stop-fetch').onclick = () => { isFetchingAll = false; };
    document.getElementById('rn-btn-fetch-page').onclick = () => fetchOnePage(false);
    document.getElementById('rn-btn-load-more').onclick = () => fetchOnePage(false);
    document.getElementById('rn-btn-reset').onclick = () => {
        isFetchingAll = false;
        followingUsers = [];
        selectedUids.clear();
        currentCursor = '';
        hasMoreData = false;
        renderListView();
        updateStatsUI();
        document.getElementById('rn-footer-status').innerText = '已重置清空';
    };

    // 筛选标签切换
    function setFilter(mode) {
        currentFilterMode = mode;
        const allBtn = document.getElementById('rn-filter-all');
        const mutualBtn = document.getElementById('rn-filter-mutual');
        const singleBtn = document.getElementById('rn-filter-single');
        allBtn.style.background = mode === 'all' ? '#0f172a' : '#fff';
        allBtn.style.color = mode === 'all' ? '#fff' : '#334155';
        mutualBtn.style.background = mode === 'mutual' ? '#059669' : '#fff';
        mutualBtn.style.color = mode === 'mutual' ? '#fff' : '#334155';
        singleBtn.style.background = mode === 'single' ? '#0f172a' : '#fff';
        singleBtn.style.color = mode === 'single' ? '#fff' : '#334155';
        renderListView();
    }
    document.getElementById('rn-filter-all').onclick = () => setFilter('all');
    document.getElementById('rn-filter-mutual').onclick = () => setFilter('mutual');
    document.getElementById('rn-filter-single').onclick = () => setFilter('single');

    // 搜索
    document.getElementById('rn-search-input').oninput = () => renderListView();

    // 全选 / 取消全选 (智能切换)
    document.getElementById('rn-btn-select-all').onclick = () => {
        const currentSorted = getSortedList();
        const allSelected = currentSorted.length > 0 && currentSorted.every(u => selectedUids.has(String(u.userId)));
        if (allSelected) {
            currentSorted.forEach(u => selectedUids.delete(String(u.userId)));
        } else {
            currentSorted.forEach(u => selectedUids.add(String(u.userId)));
        }
        renderListView();
    };

    // 反选
    const invertBtn = document.getElementById('rn-btn-invert');
    if (invertBtn) {
        invertBtn.onclick = () => {
            const currentSorted = getSortedList();
            currentSorted.forEach(u => {
                const uidStr = String(u.userId);
                if (selectedUids.has(uidStr)) selectedUids.delete(uidStr);
                else selectedUids.add(uidStr);
            });
            renderListView();
        };
    }

    // 重点：一键仅勾选所有单向关注的人（贴心保护互关好友）
    document.getElementById('rn-btn-select-single-only').onclick = () => {
        selectedUids.clear();
        followingUsers.forEach(u => {
            if (!isMutualFollow(u)) { // 仅勾选非互关
                selectedUids.add(String(u.userId));
            }
        });
        renderListView();
        alert(`已为您自动勾选了全部 ${selectedUids.size} 位【单向关注】用户（已自动排除互关好友）！`);
    };

    // 清空选择 / 全部取消勾选
    document.getElementById('rn-btn-clear').onclick = () => {
        selectedUids.clear();
        renderListView();
    };

    // 批量取关执行 (安全延时 1.2s，带实时进度)
    document.getElementById('rn-btn-batch-unfollow').onclick = async () => {
        if (selectedUids.size === 0 || isExecutingUnfollow) return;

        const targetList = followingUsers.filter(u => selectedUids.has(String(u.userId)));
        const mutualSelectedCount = targetList.filter(u => isMutualFollow(u)).length;

        let confirmMsg = `⚠️ 批量取关确认：您已勾选 ${targetList.length} 位博主。`;
        if (mutualSelectedCount > 0) {
            confirmMsg += `\n\n注意：其中包含了 ${mutualSelectedCount} 位【互相关注】的好友！`;
        }
        confirmMsg += `\n\n为防触发平台风控，每个请求将保持 1.2 秒安全间隔，是否开始执行？`;

        if (!confirm(confirmMsg)) return;

        const http = await getNativeHttp();
        if (!http) return alert('未找到合法请求实例');

        isExecutingUnfollow = true;
        updateSelectedCountUI();
        const footerStatus = document.getElementById('rn-footer-status');
        let success = 0;
        let fail = 0;
        console.log(`[Rednote助手] 🚀 开始批量取关任务 -> 待取关总数: ${targetList.length} 人 (其中包含互关好友: ${mutualSelectedCount} 人)`);

        for (let i = 0; i < targetList.length; i++) {
            const u = targetList[i];
            const uidStr = String(u.userId);
            footerStatus.innerText = `[${i + 1}/${targetList.length}] 正在取关: ${u.nickname}...`;
            console.log(`[Rednote助手] [${i + 1}/${targetList.length}] 发送取关请求 -> ${u.nickname} (UID: ${u.userId})`);
            let isOk = false;
            let errMsg = '';
            try {
                const res = await http.post('/api/sns/web/v1/user/unfollow', { target_user_id: u.userId }, { timeout: 30000 });
                const resData = (res && typeof res.data !== 'undefined') ? res.data : res;
                // 准确识别小红书原生返回的 { fstatus: 'none' } 或 { code: 0, success: true }
                const isSuccess = checkUnfollowSuccess(res);

                if (isSuccess) {
                    isOk = true;
                    success++;
                    selectedUids.delete(uidStr);
                    followingUsers = followingUsers.filter(x => String(x.userId) !== uidStr);
                    console.log(`[Rednote助手] [${i + 1}/${targetList.length}] 取关成功 -> ${u.nickname}`, resData);
                } else {
                    fail++;
                    errMsg = resData?.msg || resData?.message || resData?.error || resData?.detail;
                    if (!errMsg && typeof res === 'object') {
                        try { errMsg = JSON.stringify(res); } catch(e) {}
                    }
                    errMsg = errMsg || '接口响应异常';
                    console.warn(`[Rednote助手] [${i + 1}/${targetList.length}] 取关未成功 -> ${u.nickname} (UID: ${u.userId}) | 原因: ${errMsg}`, res);
                }
            } catch(e) {
                fail++;
                const errData = e?.response?.data;
                errMsg = errData?.msg || errData?.message || e.message || '网络请求异常';
                console.error(`[Rednote助手] [${i + 1}/${targetList.length}] 取关请求异常 -> ${u.nickname} (UID: ${u.userId})`, e);
            }

            // 记录取关明细日志
            unfollowRecords.push({
                time: new Date().toLocaleString(),
                userId: uidStr,
                nickname: u.nickname,
                relation: isMutualFollow(u) ? '互相关注' : '单向关注',
                fansCount: u.fansCount || 0,
                status: isOk ? '成功' : '失败',
                errorReason: errMsg,
                profileUrl: `${location.origin}/user/profile/${u.userId}`
            });

            renderListView();
            updateStatsUI();

            // 1.2 秒安全延时
            if (i < targetList.length - 1) {
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        isExecutingUnfollow = false;
        console.log(`[Rednote助手] 🏁 批量取关任务全部结束 -> 成功: ${success} 人, 失败: ${fail} 人`);
        footerStatus.innerText = `批量取关结束！成功: ${success}，失败: ${fail}`;
        alert(`批量取关任务结束！成功取关 ${success} 人${fail > 0 ? `，失败 ${fail} 人` : ''}。\n您可点击底部【📥 导出取关记录 (CSV)】导出完整明细！`);
        updateSelectedCountUI();
    };

    // 导出 CSV 工具函数 (带 UTF-8 BOM，防止 Excel 打开中文乱码)
    function downloadCSV(filename, csvContent) {
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function formatDateForFilename() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    // 诉求 1：导出本次取关的操作日志
    function exportUnfollowRecords() {
        if (unfollowRecords.length === 0) {
            alert('当前尚无取关记录！在执行单个或批量取关后，将在此生成操作日志供导出。');
            return;
        }
        const headers = ['序号', '取关时间', '博主昵称', '用户UID', '关系状态', '粉丝数', '取关结果', '个人主页链接', '失败原因'];
        const rows = unfollowRecords.map((r, idx) => [
            idx + 1,
            `"${r.time}"`,
            `"${(r.nickname || '').replace(/"/g, '""')}"`,
            `"\t${r.userId}"`,
            `"${r.relation}"`,
            r.fansCount,
            `"${r.status}"`,
            `"${r.profileUrl}"`,
            `"${(r.errorReason || '').replace(/"/g, '""')}"`
        ]);
        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        console.log('[Rednote助手] 导出取关记录 CSV 完成 -> 记录行数:', rows.length);
        downloadCSV(`Rednote_批量取关记录_${formatDateForFilename()}.csv`, csv);
    }

    // 导出全量关注列表备份
    function exportFollowingBackup() {
        if (followingUsers.length === 0) {
            alert('当前列表为空！请先点击【⚡ 一键拉取全部】加载关注数据后再导出备份。');
            return;
        }
        const headers = ['序号', '博主昵称', '用户UID', '关系状态', '粉丝数', '笔记数', '个人主页链接', '个人简介'];
        const list = getSortedList();
        const rows = list.map((u, idx) => [
            idx + 1,
            `"${(u.nickname || '').replace(/"/g, '""')}"`,
            `"\t${u.userId}"`,
            `"${isMutualFollow(u) ? '互相关注' : '单向关注'}"`,
            u.fansCount || 0,
            u.noteCount || 0,
            `"${location.origin}/user/profile/${u.userId}"`,
            `"${(u.desc || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`
        ]);
        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        console.log('[Rednote助手] 导出关注列表备份 CSV 完成 -> 博主总数:', rows.length);
        downloadCSV(`Rednote_关注列表备份_${formatDateForFilename()}.csv`, csv);
    }

    // 绑定导出事件
    document.getElementById('rn-btn-export-records').onclick = exportUnfollowRecords;
    document.getElementById('rn-btn-export-backup').onclick = exportFollowingBackup;

})();
