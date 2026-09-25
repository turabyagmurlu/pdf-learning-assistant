import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik — TY PDF",
  description: "TY PDF hangi verileri saklar, yapay zekâya neyi gönderir, verilerini nasıl indirir ya da silersin.",
};

const CONTACT = "turab7123@gmail.com";
const UPDATED = "25 Eylül 2026";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-heading text-xl">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-text-primary">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 md:py-16">
      <a href="/login" className="inline-flex min-h-[44px] items-center text-sm text-text-secondary hover:text-text-primary">← TY PDF</a>
      <h1 className="mt-4 font-heading text-3xl">Gizlilik</h1>
      <p className="mt-2 text-sm text-text-secondary">Son güncelleme: {UPDATED}. Kısa ve sade tuttuk; sorun olursa bize yaz.</p>

      <div role="note" className="mt-8 rounded-lg border-l-4 border-warning bg-surface-muted px-4 py-3 text-[15px] leading-relaxed">
        <p className="font-medium">Özetle</p>
        <p className="mt-1">
          Sorularını ve kaynak metinlerini yanıt üretmek için Google Gemini&apos;ye gönderiyoruz. Ücretsiz katmanda Google
          bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli/kişisel belge yükleme.
        </p>
      </div>

      <Section id="neler" title="Neleri saklıyoruz">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Hesap bilgilerin: adın ve e-posta adresin. Şifren yalnızca geri çevrilemez bir özet olarak saklanır; biz de göremeyiz.</li>
          <li>Yüklediğin ya da eklediğin kaynaklar (dosyalar, linkler, YouTube videolarının dökümleri, yapıştırdığın metinler) ve bunlardan çıkarılan metin.</li>
          <li>Defterlerin, notların, vurguların, sohbet geçmişin ve taslakların.</li>
          <li>Günlük yapay zekâ kullanım sayın (günlük sınırı uygulamak için).</li>
        </ul>
        <p>Reklam, izleme çerezi ya da üçüncü taraf analiz aracı kullanmıyoruz. Oturumun yalnızca kendi tarayıcında saklanır.</p>
      </Section>

      <Section id="yapay-zeka" title="Yapay zekâ ve Google Gemini">
        <p>
          Kaynaklarını özetlemek, aranabilir hâle getirmek ve sorularına cevap vermek için şu içerikler Google&apos;ın
          yapay zekâ servisine (Gemini) gönderilir: kaynak metinleri, soruların, taranmış sayfa görüntüleri, ses kayıtları ve
          seslendirilecek metinler. &quot;Web&apos;de bul&quot; özelliğini kullanırsan aradığın konu Google aramasına gider.
        </p>
        <p>
          Şu an Gemini&apos;nin <strong>ücretsiz katmanını</strong> kullanıyoruz. Google&apos;ın ücretsiz katman koşullarına göre
          gönderilen içerik Google tarafından hizmetlerini geliştirmek için kullanılabilir ve incelenebilir. Bu yüzden
          <strong> gizli, kişisel ya da yayımlanmamış belgeleri</strong> (kimlik, sağlık bilgisi, yayımlanmamış araştırma verisi gibi)
          yükleme.
        </p>
        <p>Cevaplar kaynaklarına dayanır ve atıf gösterir; yine de önemli bilgileri kaynağından kontrol et.</p>
      </Section>

      <Section id="nerede" title="Veriler nerede duruyor">
        <p>
          Yüklediğin dosyalar Supabase depolamasında, <strong>Avrupa Birliği bölgesinde</strong> (AWS eu-west-1, İrlanda) saklanır.
          Hesap bilgilerin ve metin verilerin Supabase veritabanında tutulur. Uygulama sunucusu Render üzerinde çalışır;
          istekler bu sunucudan geçer. Tüm bağlantılar şifrelidir (HTTPS).
        </p>
        <p>Verilerin haftada bir otomatik olarak yedeklenir; en fazla son 8 haftalık yedek tutulur.</p>
      </Section>

      <Section id="kimler" title="Kimler görebilir">
        <p>
          Defterlerin ve kaynakların yalnızca senin hesabında görünür. Şu an defter paylaşma yok. Başka kullanıcılar senin
          içeriğini ya da kullanımını göremez.
        </p>
      </Section>

      <Section id="indir" title="Verilerini indirme">
        <p>
          Uygulamada <strong>Verilerin</strong> bölümündeki <strong>Verilerimi indir</strong> düğmesiyle defterlerini, notlarını,
          sohbetlerini, taslaklarını ve kaynak metinlerini tek dosya (JSON) olarak istediğin an indirebilirsin. Yüklediğin
          orijinal dosyalar bu dosyada yer almaz.
        </p>
      </Section>

      <Section id="sil" title="Hesabını silme">
        <p>
          Uygulamada <strong>Verilerin</strong> bölümündeki <strong>Hesabımı sil</strong> ile, şifreni girerek hesabını kendin
          silebilirsin. Silince tüm defterlerin, kaynakların (dosyalar dahil), notların, sohbetlerin ve taslakların hemen
          kalıcı olarak silinir ve oturumun kapanır. Bu işlem geri alınamaz; önce <strong>Verilerimi indir</strong> ile bir
          kopya almanı öneririz.
        </p>
        <p>Silinen veriler haftalık yedeklerden de en geç 8 hafta içinde, eski yedekler döndükçe kendiliğinden kalkar.</p>
      </Section>

      <Section id="sifre" title="Şifre ve güvenlik">
        <p>
          Şifreni unutursan giriş ekranındaki <strong>Şifremi unuttum</strong> ile e-postana 30 dakika geçerli, tek kullanımlık
          bir bağlantı gönderilir. Şifren değişince diğer cihazlardaki açık oturumların kapanır.
        </p>
      </Section>

      <Section id="iletisim" title="İletişim">
        <p>
          Gizlilik, veri silme ya da hesabınla ilgili her soru için:{" "}
          <a href={`mailto:${CONTACT}`} className="font-medium text-accent-purple underline underline-offset-2">{CONTACT}</a>
        </p>
        <p className="text-sm text-text-secondary">
          Bu sayfa bilgilendirme amaçlıdır; resmî KVKK aydınlatma metni yerine geçmez.
        </p>
      </Section>
    </main>
  );
}
