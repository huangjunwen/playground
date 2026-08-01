/**
 * Inline Agda source corpus for ALS benchmark — small / medium / large.
 *
 * Each source is self-contained (no cross-imports between Small/Medium/Large)
 * so per-size timing is independent. All three import growing subsets of
 * Agda.Builtin.* to exercise realistic module resolution + type checking.
 * Sources include definitional equalities (provable by `refl`) plus a few
 * holes (`{! ... !}`) to exercise the goal machinery.
 *
 * Module names match filenames so cmdLoad can resolve them.
 */

export interface BenchSource {
  /** Display label, also used as row key in the markdown table. */
  name: 'small' | 'medium' | 'large';
  /** Workspace-relative filename; module name inside the file must match. */
  file: string;
  /** Agda source body. */
  src: string;
  /** Approximate line count for documentation only. */
  lines: number;
}

export const SMALL_SRC = `module Small where

open import Agda.Primitive using (Level; lzero)
open import Agda.Builtin.Nat using (Nat; zero; suc; _+_)
open import Agda.Builtin.Bool using (Bool; true; false)
open import Agda.Builtin.Equality using (_≡_; refl)

not : Bool → Bool
not true  = false
not false = true

_∧_ : Bool → Bool → Bool
true  ∧ b = b
false ∧ _ = false

_∨_ : Bool → Bool → Bool
true  ∨ _ = true
false ∨ b = b

inc : Nat → Nat
inc n = suc n

double : Nat → Nat
double zero = zero
double (suc n) = suc (suc (double n))

zero-+ : (n : Nat) → 0 + n ≡ n
zero-+ n = refl

inc-suc : (n : Nat) → inc n ≡ suc n
inc-suc n = refl

ex1 : Nat
ex1 = {! 1 + 1 !}
`;

export const MEDIUM_SRC = `module Medium where

open import Agda.Primitive using (Level; lzero; lsuc; _⊔_)
open import Agda.Builtin.Nat using (Nat; zero; suc; _+_; _*_)
open import Agda.Builtin.Bool using (Bool; true; false)
open import Agda.Builtin.Equality using (_≡_; refl)
open import Agda.Builtin.List using (List; []; _∷_)
open import Agda.Builtin.Unit using (⊤; tt)
open import Agda.Builtin.Maybe using (Maybe; just; nothing)
open import Agda.Builtin.Sigma using (Σ; _,_; fst; snd)

-- Equality helpers (defined locally — sym/cong are NOT in Agda.Builtin.*)
sym : {A : Set} {x y : A} → x ≡ y → y ≡ x
sym refl = refl

cong : {A B : Set} (f : A → B) {x y : A} → x ≡ y → f x ≡ f y
cong f refl = refl

-- Booleans
not : Bool → Bool
not true  = false
not false = true

_∧_ : Bool → Bool → Bool
true  ∧ b = b
false ∧ _ = false

_∨_ : Bool → Bool → Bool
true  ∨ _ = true
false ∨ b = b

xor : Bool → Bool → Bool
xor a b = (a ∧ not b) ∨ (not a ∧ b)

-- Nat helpers
double : Nat → Nat
double zero = zero
double (suc n) = suc (suc (double n))

square : Nat → Nat
square zero = zero
square (suc n) = square n + (2 * n) + 1

-- List ops
length : {A : Set} → List A → Nat
length [] = 0
length (_ ∷ xs) = 1 + length xs

map : {A B : Set} → (A → B) → List A → List B
map f [] = []
map f (x ∷ xs) = f x ∷ map f xs

_++_ : {A : Set} → List A → List A → List A
[] ++ ys = ys
(x ∷ xs) ++ ys = x ∷ (xs ++ ys)

filter : {A : Set} → (A → Bool) → List A → List A
filter p [] = []
filter p (x ∷ xs) with p x
... | true  = x ∷ filter p xs
... | false = filter p xs

replicate : {A : Set} → Nat → A → List A
replicate zero _ = []
replicate (suc n) x = x ∷ replicate n x

-- Maybe ops
mapMaybe : {A B : Set} → (A → B) → Maybe A → Maybe B
mapMaybe f nothing = nothing
mapMaybe f (just x) = just (f x)

-- Sigma projection example
pair : {A B : Set} → A → B → Σ A (λ _ → B)
pair a b = (a , b)

-- Definitional + inductive proofs
zero-+ : (n : Nat) → 0 + n ≡ n
zero-+ n = refl

length-nil : {A : Set} → length {A} [] ≡ 0
length-nil = refl

length-replicate : {A : Set} (n : Nat) (a : A) → length (replicate n a) ≡ n
length-replicate zero a = refl
length-replicate (suc n) a = cong suc (length-replicate n a)

++-nil : {A : Set} (xs : List A) → xs ++ [] ≡ xs
++-nil [] = refl
++-nil (x ∷ xs) = cong (x ∷_) (++-nil xs)

-- Holes for interactive testing
ex1 : Nat → Nat
ex1 n = {! double n !}

ex2 : {A : Set} → List A → List A
ex2 xs = {! xs !}
`;

export const LARGE_SRC = `module Large where

open import Agda.Primitive using (Level; lzero; lsuc; _⊔_)
open import Agda.Builtin.Nat using (Nat; zero; suc; _+_; _*_; _-_)
open import Agda.Builtin.Bool using (Bool; true; false)
open import Agda.Builtin.Equality using (_≡_; refl)
open import Agda.Builtin.List using (List; []; _∷_)
open import Agda.Builtin.Unit using (⊤; tt)
open import Agda.Builtin.Maybe using (Maybe; just; nothing)
open import Agda.Builtin.Sigma using (Σ; _,_; fst; snd)
open import Agda.Builtin.Int using (Int; pos; negsuc)
open import Agda.Builtin.String using (String)
open import Agda.Builtin.Float using (Float)

-- Equality reasoning helpers
sym : {A : Set} {x y : A} → x ≡ y → y ≡ x
sym refl = refl

cong : {A B : Set} (f : A → B) {x y : A} → x ≡ y → f x ≡ f y
cong f refl = refl

cong₂ : {A B C : Set} (f : A → B → C) {x y : A} {u v : B}
      → x ≡ y → u ≡ v → f x u ≡ f y v
cong₂ f refl refl = refl

trans : {A : Set} {x y z : A} → x ≡ y → y ≡ z → x ≡ z
trans refl q = q

-- Boolean algebra
not : Bool → Bool
not true  = false
not false = true

_∧_ : Bool → Bool → Bool
true  ∧ b = b
false ∧ _ = false

_∨_ : Bool → Bool → Bool
true  ∨ _ = true
false ∨ b = b

xor : Bool → Bool → Bool
xor a b = (a ∧ not b) ∨ (not a ∧ b)

-- Nat arithmetic
double : Nat → Nat
double zero = zero
double (suc n) = suc (suc (double n))

square : Nat → Nat
square zero = zero
square (suc n) = square n + (2 * n) + 1

-- Dependent types: Fin and Vec
data Fin : Nat → Set where
  fzero : {n : Nat} → Fin (suc n)
  fsuc  : {n : Nat} → Fin n → Fin (suc n)

data Vec (A : Set) : Nat → Set where
  []V  : Vec A 0
  _∷V_ : {n : Nat} → A → Vec A n → Vec A (suc n)

headV : {A : Set} {n : Nat} → Vec A (suc n) → A
headV (x ∷V _) = x

tailV : {A : Set} {n : Nat} → Vec A (suc n) → Vec A n
tailV (_ ∷V xs) = xs

mapV : {A B : Set} {n : Nat} → (A → B) → Vec A n → Vec B n
mapV f []V = []V
mapV f (x ∷V xs) = f x ∷V mapV f xs

-- List operations
length : {A : Set} → List A → Nat
length [] = 0
length (_ ∷ xs) = 1 + length xs

map : {A B : Set} → (A → B) → List A → List B
map f [] = []
map f (x ∷ xs) = f x ∷ map f xs

_++_ : {A : Set} → List A → List A → List A
[] ++ ys = ys
(x ∷ xs) ++ ys = x ∷ (xs ++ ys)

filter : {A : Set} → (A → Bool) → List A → List A
filter p [] = []
filter p (x ∷ xs) with p x
... | true  = x ∷ filter p xs
... | false = filter p xs

replicate : {A : Set} → Nat → A → List A
replicate zero _ = []
replicate (suc n) x = x ∷ replicate n x

reverse : {A : Set} → List A → List A
reverse [] = []
reverse (x ∷ xs) = reverse xs ++ (x ∷ [])

concat : {A : Set} → List (List A) → List A
concat [] = []
concat (xs ∷ xss) = xs ++ concat xss

-- Maybe ops
mapMaybe : {A B : Set} → (A → B) → Maybe A → Maybe B
mapMaybe f nothing = nothing
mapMaybe f (just x) = just (f x)

fromMaybe : {A : Set} → A → Maybe A → A
fromMaybe d nothing = d
fromMaybe _ (just x) = x

-- Int conversion
natToInt : Nat → Int
natToInt zero = pos zero
natToInt (suc n) = pos (suc n)

-- Records
record Point : Set where
  constructor mkPoint
  field
    px : Nat
    py : Nat

open Point

origin : Point
origin = mkPoint 0 0

moveX : Point → Nat → Point
moveX p dx = mkPoint (px p + dx) (py p)

moveY : Point → Nat → Point
moveY p dy = mkPoint (px p) (py p + dy)

-- Proofs
zero-+ : (n : Nat) → 0 + n ≡ n
zero-+ n = refl

plus-zero : (n : Nat) → n + 0 ≡ n
plus-zero zero = refl
plus-zero (suc n) = cong suc (plus-zero n)

plus-suc : (m n : Nat) → m + suc n ≡ suc (m + n)
plus-suc zero n = refl
plus-suc (suc m) n = cong suc (plus-suc m n)

length-nil : {A : Set} → length {A} [] ≡ 0
length-nil = refl

length-replicate : {A : Set} (n : Nat) (a : A) → length (replicate n a) ≡ n
length-replicate zero a = refl
length-replicate (suc n) a = cong suc (length-replicate n a)

++-nil : {A : Set} (xs : List A) → xs ++ [] ≡ xs
++-nil [] = refl
++-nil (x ∷ xs) = cong (x ∷_) (++-nil xs)

++-assoc : {A : Set} (xs ys zs : List A) → (xs ++ ys) ++ zs ≡ xs ++ (ys ++ zs)
++-assoc [] ys zs = refl
++-assoc (x ∷ xs) ys zs = cong (x ∷_) (++-assoc xs ys zs)

-- Holes for interactive testing
ex1 : Nat → Nat
ex1 n = {! double n !}

ex2 : {A : Set} → List A → List A
ex2 xs = {! reverse xs !}

ex3 : (n : Nat) → square n ≡ n * n
ex3 n = {! refl !}
`;

export const SOURCES: BenchSource[] = [
  { name: 'small', file: 'Small.agda', src: SMALL_SRC, lines: SMALL_SRC.split('\n').length },
  { name: 'medium', file: 'Medium.agda', src: MEDIUM_SRC, lines: MEDIUM_SRC.split('\n').length },
  { name: 'large', file: 'Large.agda', src: LARGE_SRC, lines: LARGE_SRC.split('\n').length },
];
