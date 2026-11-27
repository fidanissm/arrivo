# Arrivo — WhatsApp bildirişləri (avtomatik)

Arrivo bu hallarda WhatsApp mesajı növbəyə qoyur:

| Nə vaxt | Kimə | Şablon |
|---|---|---|
| Müştəri yeni sifariş verir | bütün aktiv şirkətlərin telefonuna | `arrivo_new_request` |
| Şirkət təklif göndərir və ya qiyməti dəyişir | müştəriyə | `arrivo_new_offer` |
| Müştəri təklifi seçir | həmin şirkətə | `arrivo_offer_accepted` |
| Sürücü "Yola çıxdım" basır (Arrivo sifarişində) | müştəriyə | `arrivo_driver_enroute` |

Mesajları Cloudflare worker (`worker.js`) göndərir. Worker-i README-nin 4-cü addımı ilə qurun, **Cron Trigger**-i isə `* * * * *` (hər dəqiqə) edin. Bundan başqa Meta-da WhatsApp Business API qoşulmalıdır:

1. https://developers.facebook.com → **My Apps → Create app → Business** seçin, sonra **WhatsApp** məhsulunu əlavə edin.
2. **WhatsApp → API Setup** səhifəsində:
   - Meta sizə pulsuz **sınaq nömrəsi** verir. **To** bölməsinə öz WhatsApp nömrənizi əlavə edib təsdiqləyin (sınaqda 5 nömrəyə qədər).
   - **Phone number ID** dəyərini kopyalayın, bu `WA_PHONE_ID` olacaq.
   - **Access token**: müvəqqəti token 24 saat işləyir. Daimi token üçün **Business Settings → Users → System users** bölməsində system user yaradın və `whatsapp_business_messaging` icazəsi ilə token alın.
3. **WhatsApp Manager → Message templates → Create template** bölməsində 4 şablon yaradın. Kateqoriya **Utility**, dil **Azerbaijani**, adlar və mətnlər aşağıdakı kimi olmalıdır:

**arrivo_new_request**
> Arrivo-da yeni transfer sifarişi var: {{1}}, {{2}}, {{3}}. Qiymət təklif etmək üçün Arrivo-da Sifarişlər bölməsini açın.

**arrivo_new_offer**
> Yeni təklif: {{1}} şirkəti {{3}} transferiniz üçün {{2}} təklif etdi. Təklifləri görmək və seçmək üçün Arrivo-ya daxil olun.

**arrivo_offer_accepted**
> Müştəri {{1}} sizin təklifinizi qəbul etdi: {{2}}, {{3}}. Transfer Arrivo panelinizdədir, sürücü və maşın təyin edin.

**arrivo_driver_enroute**
> Salam, {{1}}! Sürücünüz {{2}} hava limanı transferiniz üçün yola çıxdı. Maşın: {{3}}. Canlı izləyin: {{4}} Xoş yol!

   Nümunə dəyərlər (Meta soruşanda): `10.12 09:15`, `Hava limanı → Hilton Baku`, `2 nəfər, 1 baqaj`, `Baku Transfer`, `40 AZN`, `Əli`, `Rauf`, `Toyota Prius ağ, 10-AB-123`, `https://fidanissm.github.io/arrivo/#t=abc123`.

4. Worker-ə bu dəyişənləri əlavə edin:

| Ad | Növ | Dəyər |
|---|---|---|
| `WA_TOKEN` | **Secret** | access token |
| `WA_PHONE_ID` | Text | Phone number ID |
| `WA_TEST_TO` | Text | sınaq zamanı öz nömrəniz, məsələn `994501234567`. Bütün mesajlar yalnız bu nömrəyə gedir. Real istifadəyə keçəndə silin. |

5. Şablonlar **Active** olandan və real biznes nömrəsi qoşulandan sonra `WA_TEST_TO` dəyişənini silin.

✔ **Yoxla:** müştəri hesabı ilə sifariş verin, bir dəqiqə gözləyin və worker ünvanını `?key=...` ilə açın. Cavabda `"whatsapp": {"sent": 1, ...}` görünməlidir. Xəta olsa, `log`-a və Supabase-də `notifications` cədvəlinin `error` sütununa baxın. `132001` xətası şablonun adı və ya dili uyğun gəlmir deməkdir.

**Qeydlər:**
- Mesaj 2 saat ərzində göndərilməsə, köhnəlmiş sayılır və atılır.
- Müştəri sifariş formasında "WhatsApp-da xəbər al" seçimini söndürə bilər.
- Şirkətin mesajları qeydiyyatda yazdığı telefona gedir.
- Meta biznes tərəfindən başlanan hər söhbət üçün ödəniş alır, Utility mesajları ucuzdur. Qiymətlərə Meta-nın saytında baxın.
