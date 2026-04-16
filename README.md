# structure

- frontend / backend split

- frontend - react?, will prob not work on let ai design / do etc.
- backend - flask, will work on, sure we want flask, what about bun?

- SQLite db - on supabase

# things to do:
- decide frameworks
- define db structure
- do we want this for ourselves? or for others too - think for ourselves
- decide page structure and what each page does
- want to have something that tells you how to complete a collection, so like checks which series still are incomplete and shows which cars are missing
- want to automatically know how big series but this normal, mainline 250, premium 5, etc


# DB structure:

Table All Cars:
  id INTEGER NOT NULL,
  name TEXT NOT NULL, 
  series TEXT NOT NULL, 
  year INTEGER, 
  barcode INTEGER, 
  primary_color TEXT NOT NULL,
  set_number INTEGER NOT NULL, 
  PRIMARY KEY (id) );

Table User Collection:
  id INTEGER PRIMARY KEY, 
  allcars_id INTEGER NOT NULL,
  amount_owned INTEGER NOT NULL,
  card_on_off TEXT NOT NULL);
  
  
# Page Structure

- landing page? maybe to have people request their own version
- authentication
  - login
- collection page
  - add button, how do i implement the barcode feature here? as i want to in order for the all cars collection to grow, want to when i go to stores, etc be able to like scan the car or take a picture and it uploads to the website, or i will just have to take a picture and do that at home. 
  - displays the cars as cards? with picture and name etc. can click on them
  - search persistent over all pages
- analytics page
- Wishlist page
- missing cars page - do i need? or just make setting that says add cars  missing from series to wishlist?
- all cars page? to explore what cars there are and hence add to wishlist?
