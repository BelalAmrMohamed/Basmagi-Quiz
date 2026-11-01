-- Removes the fixed placeholder sentence "تم التوليد بواسطة الذكاء الاصطناعي" that
-- the editors used to write into `source` for AI-imported quizzes/lessons.
-- `source` must be a link only; an absent source is stored as no key / NULL.

update public.quizzes
set data = data #- '{meta,source}'
where data #>> '{meta,source}' = 'تم التوليد بواسطة الذكاء الاصطناعي';

update public.lessons
set source = null
where source = 'تم التوليد بواسطة الذكاء الاصطناعي';
