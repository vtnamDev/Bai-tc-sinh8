# BioSphere Slides — Bài 32 KHTN 8

Website trình chiếu khoa học có bố cục biên tập riêng cho máy tính/TV ngang và điện thoại dọc; nội dung cùng ảnh được thiết kế thành hai vùng độc lập. Bài mẫu hiện có 25 trang về **5 bệnh liên quan đến hệ tiêu hóa** theo chủ đề “Dinh dưỡng và tiêu hóa ở người” — SGK Khoa học Tự nhiên 8, tập 1, Bài 32.

Trang 25 khép lại bằng lời cảm ơn riêng gửi cô giáo và các thành viên Tổ 4, cùng lời chúc cô sức khỏe và các bạn học tốt.

## Cấu trúc
- `index.html` — thư viện bài trình chiếu, mẫu, thiết lập và khung trình chiếu.
- `styles.css` — giao diện responsive nhiều bảng màu, bố cục ảnh editorial, hiệu ứng chiều sâu và chuyển động.
- `app.js` — thư viện, tìm kiếm, nhập/xuất JSON, điều hướng slide, chia sẻ link, toàn màn hình; dữ liệu nhập được kiểm tra cấu trúc và URL tài nguyên chỉ chấp nhận HTTP(S).
- `scripts/smoke-test.mjs` và `.github/workflows/static-validation.yml` — kiểm tra tự động cú pháp, cấu trúc bài, URL tài nguyên và phiên bản cache của các tệp tĩnh.
- `bai32-deck.js` — dữ liệu 25 slide, kịch bản 5 bệnh, tình huống hỏi đáp, URL hình ảnh/video, chú thích và nguồn tham khảo.
- `assets/mark.svg` — biểu tượng BioSphere.
- `vercel.json` — cấu hình hosting tĩnh.

## Video nền trực tuyến
- Slide sử dụng video MP4 nền thật từ Pexels và Mixkit, chọn theo chủ đề (rau củ/nấu ăn, nha khoa, tư vấn y tế, hoạt hình y khoa). Video lặp im lặng, có ảnh poster để hiển thị ngay trong khi video tải.
- Pexels có bản master 3840×2160 cho năm cảnh gồm rửa rau, chuẩn bị thực phẩm và khám răng; website chỉ chọn master 4K trên màn hình lớn và đường truyền phù hợp. Trên điện thoại, website dùng bản 1080p/720p để tránh tải tệp 25 MB+ và giảm nhiệt/pin. Video chỉ tải cho slide đang xem; khi ẩn tab hoặc tắt chuyển động, video dừng.
- Các video dẫn về trang nguồn để ghi công. Pexels và Mixkit có điều kiện sử dụng riêng; kiểm tra giấy phép của từng video trước khi tái sử dụng ngoài mục đích bài thuyết trình học tập.

## Responsive presentation
- Màn hình ngang dùng hai cột rộng: nội dung và sơ đồ ở một bên, ảnh/video và ảnh phụ có ghi nhãn ở bên còn lại. Điện thoại dọc xếp ảnh ở trên và nội dung rộng ở dưới; ảnh không còn phủ sau chữ như nền toàn màn hình. Phần nội dung dài có thể cuộn trong vùng trình chiếu.
- Real footage uses stable framing without continuous zoom/rotation; movement comes from the clip itself and the slide transition. True 4K masters only load on wide landscape screens (1800px+), never on coarse-pointer portrait screens; slower networks and data-saver mode prefer lower resolution.
- Video descriptions are distinct from poster-image descriptions, so captions reflect the footage that actually plays.
- Hình được chọn theo chủ đề: sâu răng, tư vấn dạ dày, cốc nước, vệ sinh tay, thực phẩm an toàn, sơ đồ vòng đời giun và giải phẫu gan. Ảnh phụ hiển thị dạng thẻ có nhãn, mở nguồn riêng; sơ đồ y khoa được giữ tỉ lệ bằng `contain` khi cần đọc đầy đủ.

## Chuyển cảnh và hỏi đáp
- Chuyển trang theo hướng tiến/lùi với bốn preset CSS riêng: wipe, depth, focus và rise; tiêu đề, phần mô tả, từng ý chính và ảnh có nhịp xuất hiện riêng.
- Mỗi bệnh có một tình huống trắc nghiệm ngay trong phần bệnh; sau khi chọn, đáp án và giải thích được hiện để cả lớp thảo luận.
- Các cảnh có mô hình giữ nguyên ảnh gốc làm chế độ mặc định; chỉ khi chọn **Mô hình 3D** mới tải trình xem và GLB. Mô hình tham chiếu gan/ruột non thuộc Human Reference Atlas / HuBMAP (CC BY 4.0); răng, dạ dày và giun dùng mô hình sơ đồ BioSphere. Nếu WebGL/CDN hoặc GLB không tải được, giao diện chuyển sang mô hình sơ đồ dự phòng; ảnh gốc vẫn luôn có thể mở lại.
- Âm báo đúng/sai và chuyển slide có thể bật/tắt; chế độ giảm chuyển động vẫn được tôn trọng.

## Hình ảnh và thiết kế
- Mỗi trang trong bài Bài 32 có một URL ảnh thực riêng (25 trang có ảnh minh họa và nguồn ghi kèm), mô tả thay thế, ghi nguồn và liên kết mở nguồn; một số trang có thêm thẻ ảnh phụ.
- Ảnh được tải trực tiếp từ nguồn trực tuyến khi mở trang. Nguồn sử dụng gồm Wikimedia Commons (sơ đồ giải phẫu/ảnh y khoa có giấy phép ghi trên trang file), Unsplash, Pexels và một số nguồn y tế/giáo dục như WHO. Ví dụ: [sơ đồ hệ tiêu hóa trên Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Digestive_system_diagram_en.svg), [ảnh răng sâu trên Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Dental_Caries_Cavity_1.JPG), [ảnh nội soi ổ loét dạ dày](https://commons.wikimedia.org/wiki/File:Gastric_Ulcer_Antrum.jpg), [ảnh trẻ chải răng trên Pexels](https://www.pexels.com/photo/a-kid-brushing-her-teeth-7979784/).
- Vì ảnh tải trực tiếp từ máy chủ nguồn, thiết bị cần Internet; chất lượng/tốc độ có thể thay đổi theo nguồn ảnh. Trình chiếu sẽ thử dùng ảnh dự phòng nếu một URL không tải được.

## Cách trình chiếu
- Mở bài Bài 32 trong thư viện rồi chọn **Trình chiếu**.
- Trong trình chiếu, mở **Mục lục** để nhảy tới trang cụ thể; dùng nút điều khiển hoặc phím **H** để ẩn/hiện giao diện.
- Bấm nửa phải để đi tiếp, nửa trái để quay lại; phím mũi tên trái/phải dùng được ngay sau khi mở bài, kể cả sau khi bấm nút điều hướng.
- Trang 22 có vòng suy luận tình huống, trang 23 có bài kiểm tra tổng hợp 5 câu; chọn đáp án để xem phản hồi đúng/sai, lời giải thích và điểm tổng kết. Mỗi bệnh cũng có một câu hỏi chọn đáp án ngay trên trang tình huống. Nút `♫` bật/tắt âm thanh phản hồi; hiệu ứng âm thanh được tạo trong trình duyệt.
- Bật **Toàn màn hình** khi thuyết trình trên máy tính hoặc trình duyệt hỗ trợ.
- Chỉnh các dòng `[Điền họ tên]` và phân công thành viên trong `bai32-deck.js` trước khi thuyết trình.

## Nội dung khoa học
- Nền tảng theo SGK KHTN 8, Bài 32, trang in 128–134.
- Bài 32 trình bày cụ thể sâu răng, viêm loét dạ dày–tá tràng; đề cập tiêu chảy du lịch và an toàn vệ sinh thực phẩm.
- Bài trình chiếu tập trung vào năm bệnh: sâu răng, viêm loét dạ dày–tá tràng, tiêu chảy do nhiễm trùng, nhiễm giun đường ruột và viêm gan A. Hai bệnh đầu là phần được trình bày trực tiếp trong SGK; các phần mở rộng được gắn nguồn WHO/CDC/NIDDK phù hợp.
- Bài mang tính giáo dục sức khỏe, không dùng để tự chẩn đoán hay tự điều trị. Khi có dấu hiệu nặng, cần báo người lớn và đến cơ sở y tế.

## Giới hạn hiện tại
Website là bản tĩnh. Bài Bài 32 đã đóng gói cùng website nên liên kết trình chiếu bài này có thể mở trên thiết bị khác. Các bản nháp/tệp nhập được lưu trong bộ nhớ của trình duyệt hiện tại; chúng chưa đồng bộ qua tài khoản hay cơ sở dữ liệu. Ảnh của bài mẫu được tải từ nguồn trực tuyến, không được chép thành tệp ảnh nội bộ trong repository. Link hiện chưa có bảo vệ bằng mật khẩu. Không đưa thông tin riêng tư của học sinh lên mã nguồn công khai.

## Nguồn tham khảo chính
- SGK Khoa học Tự nhiên 8, tập 1 — Bài 32, trang in 128–134.
- WHO: [Diarrhoeal disease](https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease), [Soil-transmitted helminth infections](https://www.who.int/news-room/fact-sheets/detail/soil-transmitted-helminth-infections), [Hepatitis A](https://www.who.int/news-room/fact-sheets/detail/hepatitis-a), [Food safety in Viet Nam](https://www.who.int/vietnam/health-topics/food-safety/food-safety).
- Human Reference Atlas / HuBMAP: [Small intestine, male v1.2](https://apps.humanatlas.io/kg-explorer/ref-organ/small-intestine-male/v1.2) and [3D Reference Object Library](https://humanatlas.io/3d-reference-library), licensed CC BY 4.0. GLB endpoints: [VH_M_Small_Intestine.glb](https://ccf-ontology.hubmapconsortium.org/objects/v1.2/VH_M_Small_Intestine.glb), [VH_M_Liver.glb](https://ccf-ontology.hubmapconsortium.org/objects/v1.2/VH_M_Liver.glb).
- CDC: [About Cavities (Tooth Decay)](https://www.cdc.gov/oral-health/about/cavities-tooth-decay.html), [DPDx — Ascariasis](https://www.cdc.gov/dpdx/ascariasis/).
- NIDDK: [Peptic ulcers](https://www.niddk.nih.gov/health-information/digestive-diseases/peptic-ulcers-stomach-ulcers/symptoms-causes).

## Kiểm tra tự động
Mỗi pull request hướng vào `main` chạy kiểm tra cú pháp JavaScript và bộ smoke test cho 25 slide, 5 câu hỏi tình huống có trắc nghiệm, 5 cảnh 3D, các câu hỏi tương tác, các URL tài nguyên trong deck và cache key thống nhất. Các kiểm tra này bắt lỗi dữ liệu/cấu trúc cơ bản; chúng không thay thế kiểm thử trực quan trên trình duyệt hoặc kiểm tra khả dụng theo thời gian thực của máy chủ ảnh/video.

## Deploy
GitHub `main` được kết nối với Vercel; thay đổi trên nhánh chính sẽ tạo deployment mới.


## Hiệu năng thích ứng
- Cài đặt có ba mức: Tự động, Mượt nhẹ và Điện ảnh. Tự động xem xét tín hiệu mạng, Data Saver, số luồng CPU và dung lượng RAM ước tính nếu trình duyệt cung cấp.
- Trên kết nối chậm hoặc thiết bị giới hạn, website giảm hiệu ứng nền nặng, giới hạn độ phân giải canvas/3D và bỏ tải trước ảnh láng giềng. Video nền chỉ phát khi phù hợp với cài đặt chuyển động và điều kiện kết nối.
- Mức Điện ảnh có thể tăng chất lượng hiệu ứng, nhưng không bỏ qua Data Saver, trạng thái ngoại tuyến hoặc tuỳ chọn giảm chuyển động. Mô hình 3D vẫn tải theo yêu cầu; ảnh tĩnh không bị thay thế.
- Tải trước ảnh slide được trì hoãn một nhịp để nhường ưu tiên mạng cho ảnh đang xem; Tự động chỉ làm ấm ảnh kế tiếp, còn Điện ảnh có thể làm ấm cả slide trước và sau trên mạng phù hợp.


## Bộ nhớ đệm ngoại tuyến
- Trên HTTPS (hoặc localhost), service worker lưu vỏ ứng dụng cùng domain: HTML, CSS, JavaScript, dữ liệu bài học và logo. Lượt mở lại có thể dùng bộ nhớ đệm và trang chính có thể tải lại khi mất mạng sau lần truy cập trực tuyến đầu tiên.
- Bộ đệm được phiên bản hóa và xóa bản shell cũ khi cập nhật. Không tải trước hay lưu hàng loạt ảnh, video, CDN hoặc mô hình 3D bên ngoài; các tài nguyên đó vẫn cần mạng, còn ảnh mặc định và giao diện dự phòng vẫn được giữ.
- Nếu trình duyệt chặn service worker, website vẫn hoạt động bình thường khi trực tuyến.


## Bản 25 trang — nội dung dày hơn, chuyển cảnh nhẹ hơn
- Bản bài học gộp các trang mở đầu và phần giải thích trùng lặp, còn 25 trang; phần cốt lõi về cả năm bệnh, nguồn tham khảo và hai vòng ôn tập vẫn được giữ.
- Mỗi bệnh có một câu hỏi tình huống chọn đáp án ngay trên trang bệnh. Sau lựa chọn, các phương án bị khóa, đáp án đúng và lời giải hiện ra để cả lớp thảo luận; cuối bài vẫn có hai vòng quiz tổng hợp.
- Ảnh từ Unsplash/Pexels được yêu cầu ở kích thước phù hợp hơn với viewport và cấu hình hiệu năng; ảnh phụ được tải ưu tiên thấp. Ảnh chính vẫn là lớp hiển thị trước, video nền chỉ được gắn nguồn khi chế độ chuyển động/thiết bị/mạng cho phép.
- Hiệu ứng hạt canvas giữ chuyển động và màu sắc nhưng gom thao tác vẽ vào ít lần gọi hơn; chuyển cảnh không nhân bản video, canvas hoặc mô hình 3D đang hoạt động.
- Bộ kiểm tra tự động kiểm tra 25 trang, năm câu hỏi tình huống, tài nguyên 3D và các quy tắc tối ưu hóa. Browser smoke test kiểm tra câu hỏi chọn đáp án trên Chromium di động cùng điều hướng, 3D và offline shell.


## Hệ bố cục biên tập v10
- Mỗi trang có thứ bậc tiêu đề, mô tả, sơ đồ, ý chính, câu hỏi và nguồn. Sơ đồ được chọn theo loại nội dung: tuyến tiêu hóa, bản đồ năm bệnh, nhóm chất dinh dưỡng, quy trình ba bước, so sánh dấu hiệu hoặc thói quen phòng bệnh.
- Năm phần bệnh có sơ đồ riêng đặt ngay trong vùng nội dung, không phủ trên ảnh. Sơ đồ được dựng bằng HTML/CSS, không tải thêm thư viện đồ họa.
- Thẻ ảnh phụ có nhãn đọc được, tải ưu tiên thấp; hình giải phẫu hoặc sơ đồ vòng đời dùng chế độ giữ toàn khung để tránh cắt mất nhãn.
- Kiểm thử Chromium xác nhận vùng chữ và ảnh tách nhau trên điện thoại, kiểm tra hai cột trên màn hình ngang, đồng thời tiếp tục kiểm tra quiz, 3D và shell ngoại tuyến.


## Thiết kế v12 — mạch kể chuyện giữa các trang
- Mỗi trang có một khối **Ý chính** nổi bật; bên dưới là **Ý phụ** thành các thẻ thông tin dễ quét. Sơ đồ/infographic đứng ở vai trò giải thích bằng hình, không thay thế nội dung chữ.
- Màu sắc được khóa theo nhóm bài: nền tảng hệ tiêu hóa, sâu răng, loét dạ dày, tiêu chảy/mất nước, nhiễm giun, viêm gan A, tổng kết và trang kết. Ảnh giữ màu gốc, còn viền, ánh sáng, nhãn và sơ đồ dùng cùng một sắc nhấn để nội dung không bị phủ màu quá mạnh.
- Ảnh hệ tiêu hóa được thay bằng sơ đồ giải phẫu đúng chủ đề từ Wikimedia Commons (Mariana Ruiz / Jmarchn, public domain); một số trang bỏ ảnh trùng lặp để dùng minh họa sơ đồ riêng.
- Chuyển động được phân loại theo `storyGroup`: trong cùng chương dùng nhịp chuyển sâu nhẹ; khi đổi chương dùng hiệu ứng xoay 3D nông để tạo ranh giới. Không thêm thư viện animation nặng; mức Mượt nhẹ rút ngắn hiệu ứng, còn Reduced Motion tắt chuyển động.
- Hướng thiết kế tham khảo các mẫu frontend về shared transitions/layout motion trên GitHub nhưng triển khai bằng CSS/JavaScript hiện có để giữ ứng dụng gọn.


## v13 — chuyển trang một bề mặt, ảnh nét hơn
- Đã bỏ hoàn toàn việc clone trang cũ vào `.slide-transition-ghost` và thời gian giữ lớp cũ 760 ms. Mỗi lần chuyển trang thay nội dung stage ngay lập tức; chỉ trang mới chạy chuyển động vào, vì vậy DOM không giữ đồng thời hai ảnh toàn khung.
- Nhịp vào được rút xuống khoảng 0,24 giây trong cùng chương và 0,34 giây khi đổi chương; chế độ ưu tiên mượt rút ngắn thêm. Chuyển động dùng opacity/transform, không dùng blur/clip-path toàn khung trong lượt chuyển trang.
- Ảnh không còn bị tăng tương phản, bão hòa và phóng to liên tục; độ rộng ảnh được tính theo pixel density màn hình, chất lượng ảnh cao hơn trên mạng bình thường, tự giảm dung lượng khi máy báo kết nối chậm.
- Ảnh trang kế tiếp được bắt đầu tải trước sau 80 ms, ưu tiên thấp và giải mã trước khi cần; giữ cache ảnh ở mức 1 ảnh trên máy yếu và 2 ảnh trên desktop chế độ Cinema.
- Browser smoke test xác nhận có đúng một trang hoạt động trong stage, không có outgoing ghost, thời lượng chuyển cảnh bị giới hạn và URL ảnh yêu cầu đủ độ phân giải.


## v14 — HDMI / TV projector mode
- Trên máy tính màn hình rộng có nút **Chiếu TV** riêng. Nút bật bố cục máy chiếu, yêu cầu Fullscreen API ẩn UI trình duyệt khi được hỗ trợ và chuyển sang hiệu năng Điện ảnh. Có thể thoát bằng cùng nút; phím `P` bật/tắt chế độ máy chiếu, `F` bật/tắt toàn màn hình, `H` ẩn/hiện thanh điều khiển.
- Thanh công cụ chuyển sang lớp kính trong nổi phía trên, thanh tiến độ nổi phía dưới; slide dùng toàn vùng 16:9, hai cột lớn và ảnh minh họa giữ chiều cao riêng thay vì thu nhỏ do thanh công cụ chiếm chỗ.
- Khi đang ở chế độ chiếu, ảnh Unsplash/Pexels hiện tại được nâng cấp sang URL độ phân giải cao và chỉ thay ảnh sau khi bản mới giải mã xong; 3D/video vẫn được tải theo yêu cầu.
- Máy tính ở chế độ Điện ảnh có thể vẽ nền canvas tới 60 FPS, với ngân sách hạt tăng theo màn hình desktop/projector. Trên kết nối chậm hoặc chế độ Mượt, nội dung/ảnh tự giảm tải; Reduced Motion vẫn được tôn trọng.
- Kiểm thử Chromium xác nhận nút máy chiếu, trạng thái fullscreen, bố cục stage/toolbar, chỉ có một slide trong DOM, và khôi phục preset trước đó khi thoát.
