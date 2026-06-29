import prisma from '../src/db.js';

const locationTree = [
  {
    name: 'தஞ்சாவூர் மாவட்டம்',
    nameEn: 'Thanjavur District',
    type: 'DISTRICT',
    children: [
      {
        name: 'தஞ்சாவூர் வட்டம்',
        nameEn: 'Thanjavur Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'தஞ்சாவூர்',
            nameEn: 'Thanjavur',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு மெயின் தெரு', nameEn: 'East Main Street', type: 'STREET' },
              { name: 'தெற்கு மெயின் தெரு', nameEn: 'South Main Street', type: 'STREET' },
              { name: 'மேற்கு மெயின் தெரு', nameEn: 'West Main Street', type: 'STREET' }
            ]
          },
          {
            name: 'வல்லம்',
            nameEn: 'Vallam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          },
          {
            name: 'பிள்ளையார்பட்டி',
            nameEn: 'Pillaiyarpatti',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'ஒரத்தநாடு வட்டம்',
        nameEn: 'Orathanadu Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'ஒரத்தநாடு',
            nameEn: 'Orathanadu',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'காக்கரை',
            nameEn: 'Kakkarai',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' }
            ]
          },
          {
            name: 'வடக்கூர்',
            nameEn: 'Vadakkur',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'பட்டுக்கோட்டை வட்டம்',
        nameEn: 'Pattukkottai Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'பட்டுக்கோட்டை',
            nameEn: 'Pattukkottai',
            type: 'AREA',
            children: [
              { name: 'பெரிய தெரு', nameEn: 'Periya Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'ரயில்வே சாலை', nameEn: 'Railway Road', type: 'STREET' }
            ]
          },
          {
            name: 'அத்திவெட்டி',
            nameEn: 'Athivetti',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          },
          {
            name: 'மதுக்கூர்',
            nameEn: 'Madukkur',
            type: 'AREA',
            children: [
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'பேராவூரணி வட்டம்',
        nameEn: 'Peravurani Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'பேராவூரணி',
            nameEn: 'Peravurani',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'சேதுபாவாசத்திரம்',
            nameEn: 'Sethubavachatram',
            type: 'AREA',
            children: [
              { name: 'கடற்கரை சாலை', nameEn: 'Beach Road', type: 'STREET' },
              { name: 'பள்ளிவாசல் தெரு', nameEn: 'Pallivasal Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          },
          {
            name: 'மல்லிப்பட்டினம்',
            nameEn: 'Mallipattinam',
            type: 'AREA',
            children: [
              { name: 'மீனவர் தெரு', nameEn: 'Meenavar Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'கும்பகோணம் வட்டம்',
        nameEn: 'Kumbakonam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'கும்பகோணம்',
            nameEn: 'Kumbakonam',
            type: 'AREA',
            children: [
              { name: 'பெரிய பஜார் தெரு', nameEn: 'Big Bazaar Street', type: 'STREET' },
              { name: 'காந்தி சாலை', nameEn: 'Gandhi Road', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          },
          {
            name: 'சுவாமிமலை',
            nameEn: 'Swamimalai',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'தாராசுரம்',
            nameEn: 'Darasuram',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'பாபநாசம் வட்டம்',
        nameEn: 'Papanasam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'பாபநாசம்',
            nameEn: 'Papanasam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          },
          {
            name: 'அய்யம்பேட்டை',
            nameEn: 'Ayyampettai',
            type: 'AREA',
            children: [
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' }
            ]
          },
          {
            name: 'அம்மாப்பேட்டை',
            nameEn: 'Ammapettai',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'நாகப்பட்டினம் மாவட்டம்',
    nameEn: 'Nagapattinam District',
    type: 'DISTRICT',
    children: [
      {
        name: 'நாகப்பட்டினம் வட்டம்',
        nameEn: 'Nagapattinam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'நாகப்பட்டினம்',
            nameEn: 'Nagapattinam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கிழக்கு மெயின் தெரு', nameEn: 'East Main Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'நாகூர்',
            nameEn: 'Nagore',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'பள்ளிவாசல் தெரு', nameEn: 'Pallivasal Street', type: 'STREET' },
              { name: 'கடற்கரை சாலை', nameEn: 'Beach Road', type: 'STREET' }
            ]
          },
          {
            name: 'அக்கரைப்பேட்டை',
            nameEn: 'Akkaraipettai',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'நடு தெரு', nameEn: 'Middle Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'கீழ்வேளூர் வட்டம்',
        nameEn: 'Kilvelur Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'கீழ்வேளூர்',
            nameEn: 'Kilvelur',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'கீழையூர்',
            nameEn: 'Keezhaiyur',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          },
          {
            name: 'வலிவலம்',
            nameEn: 'Valivalam',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'வேதாரண்யம் வட்டம்',
        nameEn: 'Vedaranyam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'வேதாரண்யம்',
            nameEn: 'Vedaranyam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'புஷ்பவனம்',
            nameEn: 'Pushpavanam',
            type: 'AREA',
            children: [
              { name: 'முத்துக்கவுண்டர் காடு', nameEn: 'Muthukkavundar Kadu', type: 'STREET' },
              { name: 'மீனவர் தெரு', nameEn: 'Meenavar Street', type: 'STREET' },
              { name: 'அழகர்கவுண்டர் காடு', nameEn: 'Alagarkavundar Kadu', type: 'STREET' }
            ]
          },
          {
            name: 'கோவில்பத்து',
            nameEn: 'Kovilpathu',
            type: 'AREA',
            children: [
              { name: 'துளுக்கத் தெரு', nameEn: 'Thulukka Street', type: 'STREET' },
              { name: 'மேலக்காடு', nameEn: 'Melakadu', type: 'STREET' },
              { name: 'கவுண்டர்காடு', nameEn: 'Gounder Kadu', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'திருச்சிராப்பள்ளி மாவட்டம்',
    nameEn: 'Tiruchirappalli District',
    type: 'DISTRICT',
    children: [
      {
        name: 'திருச்சி வட்டம்',
        nameEn: 'Tiruchirappalli Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'திருச்சிராப்பள்ளி',
            nameEn: 'Tiruchirappalli',
            type: 'AREA',
            children: [
              { name: 'சத்திரம் பேருந்து நிலைய சாலை', nameEn: 'Chathiram Bus Stand Road', type: 'STREET' },
              { name: 'பெரிய பஜார் தெரு', nameEn: 'Big Bazaar Street', type: 'STREET' },
              { name: 'பாரதிதாசன் சாலை', nameEn: 'Bharathidasan Road', type: 'STREET' }
            ]
          },
          {
            name: 'உறையூர்',
            nameEn: 'Uraiyur',
            type: 'AREA',
            children: [
              { name: 'பெரிய பஜார் தெரு', nameEn: 'Periya Bazaar Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          },
          {
            name: 'கேன்டோன்மெண்ட்',
            nameEn: 'Cantonment',
            type: 'AREA',
            children: [
              { name: 'ரயில்வே சாலை', nameEn: 'Railway Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தேவாலய தெரு', nameEn: 'Church Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'ஸ்ரீரங்கம் வட்டம்',
        nameEn: 'Srirangam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'ஸ்ரீரங்கம்',
            nameEn: 'Srirangam',
            type: 'AREA',
            children: [
              { name: 'சித்திரை தெரு', nameEn: 'Chithirai Street', type: 'STREET' },
              { name: 'கிழக்கு அடையவளஞ்சான் தெரு', nameEn: 'East Adayavalanjan Street', type: 'STREET' },
              { name: 'மேற்கு அடையவளஞ்சான் தெரு', nameEn: 'West Adayavalanjan Street', type: 'STREET' }
            ]
          },
          {
            name: 'திருவானைக்காவல்',
            nameEn: 'Thiruvanaikaval',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'மாம்பழ சாலை',
            nameEn: 'Mambazha Salai',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'திருவெறும்பூர் வட்டம்',
        nameEn: 'Thiruverumbur Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'திருவெறும்பூர்',
            nameEn: 'Thiruverumbur',
            type: 'AREA',
            children: [
              { name: 'பாரதியார் தெரு', nameEn: 'Bharathiyar Street', type: 'STREET' },
              { name: 'காந்தி தெரு', nameEn: 'Gandhi Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' }
            ]
          },
          {
            name: 'பிஹெச்இஎல் நகரம்',
            nameEn: 'BHEL Township',
            type: 'AREA',
            children: [
              { name: 'முதல் தெரு', nameEn: 'First Street', type: 'STREET' },
              { name: 'இரண்டாம் தெரு', nameEn: 'Second Street', type: 'STREET' },
              { name: 'மூன்றாம் தெரு', nameEn: 'Third Street', type: 'STREET' }
            ]
          },
          {
            name: 'கைலாசபுரம்',
            nameEn: 'Kailasapuram',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'திருவாரூர் மாவட்டம்',
    nameEn: 'Tiruvarur District',
    type: 'DISTRICT',
    children: [
      {
        name: 'திருவாரூர் வட்டம்',
        nameEn: 'Tiruvarur Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'திருவாரூர்',
            nameEn: 'Tiruvarur',
            type: 'AREA',
            children: [
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'கிழக்கு மெயின் தெரு', nameEn: 'East Main Street', type: 'STREET' },
              { name: 'கமலாலயம் தெற்கு கரை', nameEn: 'Kamalalayam South Bank', type: 'STREET' }
            ]
          },
          {
            name: 'விஜயபுரம்',
            nameEn: 'Vijayapuram',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' }
            ]
          },
          {
            name: 'கிடாரங்கொண்டான்',
            nameEn: 'Kidaramkondan',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'நன்னிலம் வட்டம்',
        nameEn: 'Nannilam Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'நன்னிலம்',
            nameEn: 'Nannilam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'பேரளம்',
            nameEn: 'Peralam',
            type: 'AREA',
            children: [
              { name: 'ரயில்வே சாலை', nameEn: 'Railway Road', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          },
          {
            name: 'கொள்ளுமாங்குடி',
            nameEn: 'Kollumangudi',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'மன்னார்குடி வட்டம்',
        nameEn: 'Mannargudi Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'மன்னார்குடி',
            nameEn: 'Mannargudi',
            type: 'AREA',
            children: [
              { name: 'ராஜா தெரு', nameEn: 'Raja Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'கூத்தாநல்லூர்',
            nameEn: 'Koothanallur',
            type: 'AREA',
            children: [
              { name: 'பள்ளிவாசல் தெரு', nameEn: 'Mosque Street', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' }
            ]
          },
          {
            name: 'உள்ளிக்கோட்டை',
            nameEn: 'Ullikottai',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'திருத்துறைப்பூண்டி வட்டம்',
        nameEn: 'Thiruthuraipoondi Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'திருத்துறைப்பூண்டி',
            nameEn: 'Thiruthuraipoondi',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'முத்துப்பேட்டை',
            nameEn: 'Muthupet',
            type: 'AREA',
            children: [
              { name: 'கடற்கரை சாலை', nameEn: 'Beach Road', type: 'STREET' },
              { name: 'மீனவர் தெரு', nameEn: 'Meenavar Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' }
            ]
          },
          {
            name: 'கோட்டூர்',
            nameEn: 'Kottur',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'வலங்கைமான் வட்டம்',
        nameEn: 'Valangaiman Taluk',
        type: 'TALUK',
        children: [
          {
            name: 'வலங்கைமான்',
            nameEn: 'Valangaiman',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          },
          {
            name: 'அலங்குடி',
            nameEn: 'Alangudi',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Temple Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' }
            ]
          },
          {
            name: 'பூந்தோட்டம்',
            nameEn: 'Poonthottam',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  }
];

async function seedLocations(parentId: number, nodes: any[]) {
  for (const node of nodes) {
    const created = await prisma.location.create({
      data: {
        name: node.name,
        nameEn: node.nameEn || null,
        type: node.type,
        parentId
      }
    });
    console.log(`Created Location: ${node.nameEn || node.name} (${node.type})`);
    if (node.children && node.children.length > 0) {
      await seedLocations(created.id, node.children);
    }
  }
}

async function main() {
  console.log('🧹 Cleaning existing database records...');
  // Delete dynamic records first to avoid foreign key errors
  await prisma.contributionPayment.deleteMany({});
  await prisma.memberPlanEnrollment.deleteMany({});
  await prisma.contributionProfile.deleteMany({});
  await prisma.contributionPlan.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.messageLog.deleteMany({});
  await prisma.campaignTarget.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.eventResponse.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.emergencyResponse.deleteMany({});
  await prisma.emergencyRequest.deleteMany({});
  await prisma.commentLike.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.postLike.deleteMany({});
  await prisma.postReport.deleteMany({});
  await prisma.post.deleteMany({});
  await prisma.pollVote.deleteMany({});
  await prisma.pollOption.deleteMany({});
  await prisma.pollLike.deleteMany({});
  await prisma.pollCommentLike.deleteMany({});
  await prisma.pollComment.deleteMany({});
  await prisma.pollReport.deleteMany({});
  await prisma.poll.deleteMany({});
  await prisma.deletedNotification.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.broadcast.deleteMany({});
  await prisma.userLocation.deleteMany({});
  await prisma.locationAccessRequest.deleteMany({});
  await prisma.requestLocation.deleteMany({});
  await prisma.communityJoinRequest.deleteMany({});
  await prisma.communityAdminLog.deleteMany({});
  await prisma.communityComplaint.deleteMany({});
  await prisma.communityBan.deleteMany({});
  await prisma.communityAnnouncement.deleteMany({});
  await prisma.communityMemberActivity.deleteMany({});
  await prisma.communityMemberReport.deleteMany({});
  await prisma.communityLinkOrDoc.deleteMany({});
  await prisma.communityMessageStar.deleteMany({});
  await prisma.communityMessageReaction.deleteMany({});
  await prisma.communityMessageRead.deleteMany({});
  await prisma.communityMessage.deleteMany({});
  await prisma.communityPostLike.deleteMany({});
  await prisma.communityPostReport.deleteMany({});
  await prisma.communityComment.deleteMany({});
  await prisma.communityPost.deleteMany({});
  await prisma.communityMember.deleteMany({});
  await prisma.community.deleteMany({});
  await prisma.userWarning.deleteMany({});
  
  // Wipe users and members
  await prisma.member.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.profession.deleteMany({});

  console.log('🌱 Seeding State (Tamil Nadu)...');
  const state = await prisma.location.create({
    data: {
      name: 'தமிழ்நாடு',
      nameEn: 'Tamil Nadu',
      type: 'STATE'
    }
  });

  console.log('🌱 Seeding specific locations tree...');
  await seedLocations(state.id, locationTree);

  console.log('🌱 Seeding default professions...');
  const professionNames = ['Doctor', 'Lawyer', 'Farmer', 'Engineer', 'Student'];
  for (const name of professionNames) {
    await prisma.profession.create({ data: { name } });
  }


  console.log('🌱 Seeding Single SUPER_ADMIN (Thalaivar Seeman)...');
  await prisma.user.create({
    data: {
      name: 'Thalaivar Seeman',
      phone: '9000000001',
      password: 'admin123',
      role: 'SUPER_ADMIN',
      locationId: state.id,
      approvalStatus: 'APPROVED'
    }
  });

  console.log('✅ Seeding completed! Only 1 Super Admin and correct location tree seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
