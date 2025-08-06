// Aperium için basitleştirilmiş bir Express modülü simülasyonu.
// Bu modül, gerçek Express'in temel özelliklerini taklit eder.

module.exports = () => {
    console.log("Express modülü Aperium'dan başarıyla yüklendi!");

    const routes = {};
    const app = {};

    app.get = (route, handler) => {
        routes[route] = handler;
        console.log(`- GET rotası ayarlandı: ${route}`);
    };

    app.listen = (port, callback) => {
        console.log(`- Sunucu başlatılıyor: ${port}`);
        
        // Sunucu başlatma işlemini taklit et
        if (callback && typeof callback === 'function') {
            callback();
        }

        // Bir isteği taklit edelim
        if (routes['/']) {
            console.log("--- İstek taklit edildi: '/' rotasına yanıt veriliyor ---");
            const mockRequest = {};
            const mockResponse = {
                send: (message) => {
                    console.log(`Sunucudan yanıt: "${message}"`);
                }
            };
            routes['/'](mockRequest, mockResponse);
            console.log("----------------------------------------------------------");
        }
    };
    
    return app;
};
