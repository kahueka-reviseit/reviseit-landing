-- Synthetic catalogue only. Explicitly load into disposable tests or a development demonstration.
-- Curriculum access is assigned separately; these rows grant no school access or payment entitlement.
insert into public.curriculum_modules(id,name,current_release,is_demo) values
 ('demo-grade-10-sciences','Grade 10 Physical Sciences · demonstration','demo-1',true),
 ('demo-grade-11-sciences','Grade 11 Physical Sciences · demonstration','demo-1',true);
insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks) values
 ('demo-grade-10-sciences','demo-1','DEMO_01','Reading a motion graph','Mechanics','Interpret a simple graph showing an object’s motion.',10),
 ('demo-grade-10-sciences','demo-1','DEMO_02','Comparing circuit measurements','Electricity','Use a set of measurements to compare simple circuits.',15),
 ('demo-grade-10-sciences','demo-1','DEMO_03','Explaining a change of state','Matter and materials','Connect observations with a particle model of matter.',5),
 ('demo-grade-11-sciences','demo-1','DEMO_01','Interpreting a force diagram','Mechanics','Reason about forces acting on an object in a familiar setting.',15),
 ('demo-grade-11-sciences','demo-1','DEMO_02','Investigating a circuit','Electricity','Interpret measurements from a classroom circuit investigation.',20),
 ('demo-grade-11-sciences','demo-1','DEMO_03','Comparing chemical quantities','Chemical change','Interpret a small set of quantities in a chemical reaction.',10);
